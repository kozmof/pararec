const std = @import("std");
const Io = std.Io;
const http = std.http;
const net = Io.net;

const Config = struct {
    static_dir: Io.Dir,
};

pub fn main(init: std.process.Init) !void {
    const io = init.io;

    const port_str = init.environ_map.get("PORT") orelse "8080";
    const port = try std.fmt.parseInt(u16, port_str, 10);
    const static_path = init.environ_map.get("STATIC_DIR") orelse "dist";

    const static_dir = Io.Dir.cwd().openDir(io, static_path, .{}) catch |err| {
        std.log.err("cannot open static dir '{s}': {t} (run `pnpm build` first)", .{ static_path, err });
        return err;
    };
    defer static_dir.close(io);
    const config: Config = .{ .static_dir = static_dir };

    const address = try net.IpAddress.parseIp4("127.0.0.1", port);
    var listener = try address.listen(io, .{ .reuse_address = true });
    defer listener.deinit(io);
    std.log.info("listening on http://127.0.0.1:{d} (static: {s})", .{ port, static_path });

    var group: Io.Group = .init;
    defer group.cancel(io);

    while (true) {
        const stream = listener.accept(io) catch |err| {
            std.log.err("accept failed: {t}", .{err});
            continue;
        };
        group.concurrent(io, handleConnection, .{ io, init.gpa, config, stream }) catch {
            // No spare concurrency available; handle inline.
            handleConnection(io, init.gpa, config, stream);
        };
    }
}

fn handleConnection(io: Io, gpa: std.mem.Allocator, config: Config, stream: net.Stream) void {
    defer stream.close(io);

    var recv_buffer: [8192]u8 = undefined;
    var send_buffer: [8192]u8 = undefined;
    var conn_reader = stream.reader(io, &recv_buffer);
    var conn_writer = stream.writer(io, &send_buffer);
    var server: http.Server = .init(&conn_reader.interface, &conn_writer.interface);

    while (true) {
        var request = server.receiveHead() catch |err| switch (err) {
            error.HttpConnectionClosing => return,
            else => {
                std.log.debug("receiveHead: {t}", .{err});
                return;
            },
        };
        handleRequest(io, gpa, config, &request) catch |err| {
            std.log.err("{s} {s}: {t}", .{ @tagName(request.head.method), request.head.target, err });
            return;
        };
        if (!request.head.keep_alive) return;
    }
}

fn handleRequest(io: Io, gpa: std.mem.Allocator, config: Config, request: *http.Server.Request) !void {
    const target = request.head.target;
    const path = target[0 .. std.mem.indexOfAny(u8, target, "?#") orelse target.len];

    if (std.mem.startsWith(u8, path, "/api/")) return handleApi(request, path);

    if (request.head.method != .GET and request.head.method != .HEAD) {
        return request.respond("method not allowed\n", .{ .status = .method_not_allowed });
    }
    return serveStatic(io, gpa, config.static_dir, request, path);
}

fn handleApi(request: *http.Server.Request, path: []const u8) !void {
    const json_headers: []const http.Header = &.{
        .{ .name = "content-type", .value = "application/json" },
    };

    if (std.mem.eql(u8, path, "/api/health") and request.head.method == .GET) {
        return request.respond("{\"status\":\"ok\"}", .{ .extra_headers = json_headers });
    }
    return request.respond("{\"error\":\"not found\"}", .{
        .status = .not_found,
        .extra_headers = json_headers,
    });
}

fn serveStatic(
    io: Io,
    gpa: std.mem.Allocator,
    dir: Io.Dir,
    request: *http.Server.Request,
    url_path: []const u8,
) !void {
    var rel = std.mem.trimStart(u8, url_path, "/");
    if (rel.len == 0) rel = "index.html";
    if (!isSafePath(rel)) {
        return request.respond("bad request\n", .{ .status = .bad_request });
    }

    const max_size: Io.Limit = .limited(64 * 1024 * 1024);
    var file_path = rel;
    const body = dir.readFileAlloc(io, rel, gpa, max_size) catch |err| switch (err) {
        error.FileNotFound, error.IsDir => blk: {
            // SPA fallback: extension-less paths get index.html so client-side routing works.
            if (std.fs.path.extension(rel).len != 0) {
                return request.respond("not found\n", .{ .status = .not_found });
            }
            file_path = "index.html";
            break :blk try dir.readFileAlloc(io, file_path, gpa, max_size);
        },
        else => return err,
    };
    defer gpa.free(body);

    const cache_control = if (std.mem.startsWith(u8, file_path, "assets/"))
        "public, max-age=31536000, immutable"
    else
        "no-cache";

    try request.respond(body, .{ .extra_headers = &.{
        .{ .name = "content-type", .value = mimeType(file_path) },
        .{ .name = "cache-control", .value = cache_control },
    } });
}

fn isSafePath(rel: []const u8) bool {
    if (std.mem.indexOfScalar(u8, rel, 0) != null) return false;
    if (std.mem.indexOfScalar(u8, rel, '\\') != null) return false;
    if (std.mem.indexOfScalar(u8, rel, '%') != null) return false;
    var it = std.mem.splitScalar(u8, rel, '/');
    while (it.next()) |segment| {
        if (segment.len == 0 or std.mem.eql(u8, segment, ".") or std.mem.eql(u8, segment, "..")) return false;
    }
    return true;
}

fn mimeType(path: []const u8) []const u8 {
    const ext = std.fs.path.extension(path);
    const map = std.StaticStringMap([]const u8).initComptime(.{
        .{ ".html", "text/html; charset=utf-8" },
        .{ ".js", "text/javascript; charset=utf-8" },
        .{ ".mjs", "text/javascript; charset=utf-8" },
        .{ ".css", "text/css; charset=utf-8" },
        .{ ".json", "application/json" },
        .{ ".svg", "image/svg+xml" },
        .{ ".png", "image/png" },
        .{ ".jpg", "image/jpeg" },
        .{ ".jpeg", "image/jpeg" },
        .{ ".gif", "image/gif" },
        .{ ".webp", "image/webp" },
        .{ ".ico", "image/x-icon" },
        .{ ".woff", "font/woff" },
        .{ ".woff2", "font/woff2" },
        .{ ".txt", "text/plain; charset=utf-8" },
        .{ ".wasm", "application/wasm" },
    });
    return map.get(ext) orelse "application/octet-stream";
}

test isSafePath {
    try std.testing.expect(isSafePath("index.html"));
    try std.testing.expect(isSafePath("assets/app.js"));
    try std.testing.expect(!isSafePath("../etc/passwd"));
    try std.testing.expect(!isSafePath("assets/../../x"));
    try std.testing.expect(!isSafePath("a//b"));
    try std.testing.expect(!isSafePath("%2e%2e/x"));
}

test mimeType {
    try std.testing.expectEqualStrings("image/svg+xml", mimeType("favicon.svg"));
    try std.testing.expectEqualStrings("application/octet-stream", mimeType("README"));
}
