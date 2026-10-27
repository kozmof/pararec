const std = @import("std");
const schema = @import("schema.zig");
const store_module = @import("store.zig");
const Io = std.Io;
const http = std.http;

pub const Config = struct {
    static_dir: ?Io.Dir,
    store: *store_module.Store,
    document_request: *Io.Mutex,
};

pub fn handleConnection(io: Io, gpa: std.mem.Allocator, config: Config, stream: Io.net.Stream) void {
    defer stream.close(io);
    var recv_buffer: [8192]u8 = undefined;
    var send_buffer: [8192]u8 = undefined;
    var conn_reader = stream.reader(io, &recv_buffer);
    var conn_writer = stream.writer(io, &send_buffer);
    var server: http.Server = .init(&conn_reader.interface, &conn_writer.interface);
    while (true) {
        var request = server.receiveHead() catch return;
        var arena: std.heap.ArenaAllocator = .init(gpa);
        defer arena.deinit();
        handleRequest(io, arena.allocator(), config, &request) catch |err| {
            std.log.err("request failed: {t}", .{err});
            return;
        };
        if (!request.head.keep_alive) return;
    }
}

const Headers = struct {
    host: ?[]const u8 = null,
    origin: ?[]const u8 = null,
    match: ?[]const u8 = null,
    none_match: ?[]const u8 = null,
};

fn headers(request: *const http.Server.Request) !Headers {
    var result: Headers = .{};
    var it = request.iterateHeaders();
    while (it.next()) |header| {
        const slot: ?*?[]const u8 = if (std.ascii.eqlIgnoreCase(header.name, "host")) &result.host else if (std.ascii.eqlIgnoreCase(header.name, "origin")) &result.origin else if (std.ascii.eqlIgnoreCase(header.name, "if-match")) &result.match else if (std.ascii.eqlIgnoreCase(header.name, "if-none-match")) &result.none_match else null;
        if (slot) |value| {
            if (value.* != null) return error.DuplicateHeader;
            value.* = header.value;
        }
    }
    return result;
}

fn allowedHost(host: []const u8) bool {
    // Port forwarding can change the browser's port without rewriting Host.
    // Restrict the hostname to loopback and validate writes against this origin.
    const separator = std.mem.lastIndexOfScalar(u8, host, ':') orelse return false;
    const name = host[0..separator];
    if (!std.mem.eql(u8, name, "127.0.0.1") and !std.mem.eql(u8, name, "localhost")) return false;
    const port = host[separator + 1 ..];
    if (port.len == 0) return false;
    for (port) |char| {
        if (char < '0' or char > '9') return false;
    }
    return (std.fmt.parseInt(u16, port, 10) catch return false) != 0;
}

fn allowedOrigin(host: []const u8, origin: []const u8) bool {
    return std.mem.startsWith(u8, origin, "http://") and std.mem.eql(u8, host, origin[7..]);
}

fn parsePrecondition(gpa: std.mem.Allocator, h: Headers) !store_module.Precondition {
    if (h.match != null and h.none_match != null) return error.InvalidPrecondition;
    if (h.none_match) |value| {
        if (!std.mem.eql(u8, value, "*")) return error.InvalidPrecondition;
        return .create;
    }
    const value = h.match orelse return error.MissingPrecondition;
    if (std.mem.eql(u8, value, "*")) return .exists;
    if (value.len < 2 or value[0] != '"' or value[value.len - 1] != '"') return error.InvalidPrecondition;
    for (value[1 .. value.len - 1]) |char| {
        if (char == '"' or char < 0x21 or char == 0x7f) return error.InvalidPrecondition;
    }
    return .{ .match = try gpa.dupe(u8, value) };
}

fn jsonError(request: *http.Server.Request, status: http.Status, code: []const u8) !void {
    var buffer: [256]u8 = undefined;
    const body = try std.fmt.bufPrint(&buffer, "{{\"error\":\"{s}\"}}\n", .{code});
    try request.respond(body, .{ .status = status, .keep_alive = false, .extra_headers = &.{
        .{ .name = "content-type", .value = "application/json" },
        .{ .name = "cache-control", .value = "no-store" },
    } });
}

fn handleRequest(io: Io, gpa: std.mem.Allocator, config: Config, request: *http.Server.Request) !void {
    const h = headers(request) catch return jsonError(request, .bad_request, "DuplicateHeader");
    const host = h.host orelse return jsonError(request, .forbidden, "InvalidHost");
    if (!allowedHost(host)) return jsonError(request, .forbidden, "InvalidHost");
    const path = request.head.target[0 .. std.mem.indexOfAny(u8, request.head.target, "?#") orelse request.head.target.len];
    if (std.mem.startsWith(u8, path, "/api/")) {
        if (std.mem.eql(u8, path, "/api/health") and request.head.method == .GET) {
            return request.respond("{\"status\":\"ok\"}\n", .{ .extra_headers = &.{.{ .name = "content-type", .value = "application/json" }} });
        }
        if (!std.mem.eql(u8, path, "/api/document")) return jsonError(request, .not_found, "NotFound");
        // Admit before buffering or parsing to bound concurrent document memory use.
        try config.document_request.lock(io);
        defer config.document_request.unlock(io);
        switch (request.head.method) {
            .GET => {
                const title = try std.json.Stringify.valueAlloc(gpa, schema.defaultTitle(config.store.basename), .{ .escape_unicode = true });
                const document = config.store.read(io, gpa) catch |err| {
                    if (err == error.StreamTooLong) return jsonError(request, .payload_too_large, "DocumentTooLarge");
                    if (err == error.FileNotFound) return request.respond("{\"error\":\"FileNotFound\"}\n", .{ .status = .not_found, .extra_headers = &.{
                        .{ .name = "content-type", .value = "application/json" },
                        .{ .name = "cache-control", .value = "no-store" },
                        .{ .name = "x-document-title", .value = title },
                    } });
                    return jsonError(request, .internal_server_error, @errorName(err));
                };
                defer document.deinit(gpa);
                return request.respond(document.bytes, .{ .extra_headers = &.{
                    .{ .name = "content-type", .value = "application/json" },
                    .{ .name = "etag", .value = &document.tag },
                    .{ .name = "x-document-title", .value = title },
                    .{ .name = "cache-control", .value = "no-store" },
                } });
            },
            .PUT => {
                const origin = h.origin orelse return jsonError(request, .forbidden, "MissingOrigin");
                if (!allowedOrigin(host, origin)) return jsonError(request, .forbidden, "InvalidOrigin");
                const precondition = parsePrecondition(gpa, h) catch |err| return jsonError(request, if (err == error.MissingPrecondition) .precondition_required else .bad_request, @errorName(err));
                if (request.head.content_length) |length| {
                    if (length > schema.max_body_size) return jsonError(request, .payload_too_large, "BodyTooLarge");
                }
                var buffer: [8192]u8 = undefined;
                const reader = try request.readerExpectContinue(&buffer);
                const body = reader.allocRemaining(gpa, .limited(schema.max_body_size)) catch |err| return jsonError(request, if (err == error.StreamTooLong) .payload_too_large else .bad_request, @errorName(err));
                defer gpa.free(body);
                const parsed = schema.parseWithDefaultTitle(gpa, body, schema.defaultTitle(config.store.basename)) catch |err| return jsonError(request, .bad_request, @errorName(err));
                defer parsed.deinit();
                schema.validate(gpa, parsed.value) catch |err| return jsonError(request, .bad_request, @errorName(err));
                const tag = config.store.put(io, gpa, parsed.value, precondition) catch |err| return jsonError(request, if (err == error.PreconditionFailed) .precondition_failed else if (err == error.StreamTooLong) .payload_too_large else .internal_server_error, @errorName(err));
                return request.respond("{}\n", .{ .keep_alive = false, .extra_headers = &.{
                    .{ .name = "content-type", .value = "application/json" },
                    .{ .name = "etag", .value = &tag },
                    .{ .name = "cache-control", .value = "no-store" },
                } });
            },
            else => return jsonError(request, .method_not_allowed, "MethodNotAllowed"),
        }
    }
    if (request.head.method != .GET and request.head.method != .HEAD) return jsonError(request, .method_not_allowed, "MethodNotAllowed");
    if (config.static_dir) |dir| return serveStatic(io, dir, request, path);
    return serveEmbedded(request, path);
}

fn serveEmbedded(request: *http.Server.Request, url_path: []const u8) !void {
    const assets = @import("client_assets");
    const rel = std.mem.trimStart(u8, url_path, "/");
    const requested = if (rel.len == 0) "index.html" else rel;
    if (!isSafePath(requested)) return request.respond("bad request\n", .{ .status = .bad_request });
    var found: ?assets.Asset = null;
    for (assets.files) |asset| {
        if (std.mem.eql(u8, requested, asset.path)) {
            found = asset;
            break;
        }
    }
    if (found == null and std.fs.path.extension(requested).len == 0) {
        for (assets.files) |asset| {
            if (std.mem.eql(u8, asset.path, "index.html")) {
                found = asset;
                break;
            }
        }
    }
    const asset = found orelse return request.respond("not found\n", .{ .status = .not_found });
    var length_buffer: [20]u8 = undefined;
    const length = try std.fmt.bufPrint(&length_buffer, "{d}", .{asset.bytes.len});
    return request.respond(if (request.head.method == .HEAD) "" else asset.bytes, .{
        .transfer_encoding = .none,
        .extra_headers = &.{
            .{ .name = "content-length", .value = length },
            .{ .name = "content-type", .value = mimeType(asset.path) },
            .{ .name = "cache-control", .value = if (std.mem.startsWith(u8, asset.path, "assets/")) "public, max-age=31536000, immutable" else "no-cache" },
        },
    });
}

fn serveStatic(
    io: Io,
    dir: Io.Dir,
    request: *http.Server.Request,
    url_path: []const u8,
) !void {
    var rel = std.mem.trimStart(u8, url_path, "/");
    if (rel.len == 0) rel = "index.html";
    if (!isSafePath(rel)) {
        return request.respond("bad request\n", .{ .status = .bad_request });
    }

    var file_path = rel;
    const file = openStaticFile(dir, io, rel) catch |err| switch (err) {
        error.FileNotFound, error.IsDir => blk: {
            // SPA fallback: extension-less paths get index.html so client-side routing works.
            if (std.fs.path.extension(rel).len != 0) {
                return request.respond("not found\n", .{ .status = .not_found });
            }
            file_path = "index.html";
            break :blk try openStaticFile(dir, io, file_path);
        },
        else => return err,
    };
    defer file.close(io);
    const stat = try file.stat(io);
    if (stat.kind != .file) return request.respond("not found\n", .{ .status = .not_found });
    if (stat.size > 64 * 1024 * 1024) return request.respond("file too large\n", .{ .status = .payload_too_large });

    const cache_control = if (std.mem.startsWith(u8, file_path, "assets/"))
        "public, max-age=31536000, immutable"
    else
        "no-cache";

    if (request.head.method == .HEAD) {
        var length_buffer: [20]u8 = undefined;
        const length = try std.fmt.bufPrint(&length_buffer, "{d}", .{stat.size});
        return request.respond("", .{ .transfer_encoding = .none, .extra_headers = &.{
            .{ .name = "content-length", .value = length },
            .{ .name = "content-type", .value = mimeType(file_path) },
            .{ .name = "cache-control", .value = cache_control },
        } });
    }
    var send_buffer: [8192]u8 = undefined;
    var response = try request.respondStreaming(&send_buffer, .{
        .content_length = stat.size,
        .respond_options = .{ .extra_headers = &.{
            .{ .name = "content-type", .value = mimeType(file_path) },
            .{ .name = "cache-control", .value = cache_control },
        } },
    });
    var read_buffer: [8192]u8 = undefined;
    var reader = file.readerStreaming(io, &read_buffer);
    try reader.interface.streamExact64(&response.writer, stat.size);
    try response.end();
}

fn openStaticFile(dir: Io.Dir, io: Io, path: []const u8) !Io.File {
    const file = try dir.openFile(io, path, .{});
    errdefer file.close(io);
    if ((try file.stat(io)).kind != .file) return error.IsDir;
    return file;
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

test "Host and Origin must identify the same allowed server origin" {
    for ([_][]const u8{ "127.0.0.1:4545", "localhost:4545", "localhost:53129", "127.0.0.1:53129" }) |host| {
        try std.testing.expect(allowedHost(host));
    }
    for ([_][]const u8{ "evil.example:4545", "localhost.evil.example:53129", "localhost", "localhost:", "localhost:0", "localhost:65536", "localhost:+4545", "localhost:abc", "localhost:53129/" }) |host| {
        try std.testing.expect(!allowedHost(host));
    }
    try std.testing.expect(allowedOrigin("localhost:53129", "http://localhost:53129"));
    try std.testing.expect(!allowedOrigin("localhost:53129", "http://localhost:4545"));
    try std.testing.expect(allowedOrigin("localhost:4545", "http://localhost:4545"));
    try std.testing.expect(!allowedOrigin("localhost:4545", "http://127.0.0.1:4545"));
    try std.testing.expect(!allowedOrigin("localhost:4545", "null"));
}

test "preconditions support creation and single strong entity tags" {
    var arena: std.heap.ArenaAllocator = .init(std.testing.allocator);
    defer arena.deinit();
    const gpa = arena.allocator();
    try std.testing.expect((try parsePrecondition(gpa, .{ .none_match = "*" })) == .create);
    try std.testing.expect((try parsePrecondition(gpa, .{ .match = "*" })) == .exists);
    const matched = try parsePrecondition(gpa, .{ .match = "\"tag\"" });
    try std.testing.expectEqualStrings("\"tag\"", matched.match);
    try std.testing.expectError(error.MissingPrecondition, parsePrecondition(gpa, .{}));
    try std.testing.expectError(error.InvalidPrecondition, parsePrecondition(gpa, .{ .match = "W/\"tag\"" }));
    try std.testing.expectError(error.InvalidPrecondition, parsePrecondition(gpa, .{ .match = "*", .none_match = "*" }));
}
