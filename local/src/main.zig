const std = @import("std");
const http = @import("http.zig");
const store_module = @import("store.zig");
const Io = std.Io;

const usage = "Usage: pararec serve <document.json> [--port 4545] [--static ./dist]";

const Options = struct {
    document_path: []const u8,
    port: u16 = 4545,
    static_path: []const u8 = "dist",
};

fn parseArgs(args: []const []const u8) !Options {
    if (args.len < 2 or !std.mem.eql(u8, args[0], "serve") or std.mem.startsWith(u8, args[1], "--")) return error.InvalidArguments;
    var options: Options = .{ .document_path = args[1] };
    var index: usize = 2;
    var seen_port = false;
    var seen_static = false;
    while (index < args.len) : (index += 2) {
        if (index + 1 >= args.len) return error.InvalidArguments;
        if (std.mem.eql(u8, args[index], "--port") and !seen_port) {
            options.port = std.fmt.parseInt(u16, args[index + 1], 10) catch return error.InvalidPort;
            if (options.port == 0) return error.InvalidPort;
            seen_port = true;
        } else if (std.mem.eql(u8, args[index], "--static") and !seen_static) {
            options.static_path = args[index + 1];
            seen_static = true;
        } else return error.InvalidArguments;
    }
    if (options.document_path.len == 0 or options.static_path.len == 0) return error.InvalidArguments;
    return options;
}

pub fn main(init: std.process.Init) !void {
    const io = init.io;
    const args = try init.minimal.args.toSlice(init.arena.allocator());
    if (args.len == 2 and (std.mem.eql(u8, args[1], "--help") or std.mem.eql(u8, args[1], "-h"))) {
        std.log.info("{s}", .{usage});
        return;
    }
    const options = parseArgs(args[1..]) catch |err| {
        std.log.err("{s}\n{t}", .{ usage, err });
        return err;
    };
    const parent = std.fs.path.dirname(options.document_path) orelse ".";
    const basename = std.fs.path.basename(options.document_path);
    if (basename.len == 0 or std.mem.eql(u8, basename, ".") or std.mem.eql(u8, basename, "..")) return error.InvalidDocumentPath;
    const document_dir = try Io.Dir.cwd().openDir(io, parent, .{ .iterate = true });
    defer document_dir.close(io);
    const static_dir = Io.Dir.cwd().openDir(io, options.static_path, .{}) catch |err| {
        std.log.err("cannot open static directory '{s}': {t} (run pnpm build:client first)", .{ options.static_path, err });
        return err;
    };
    defer static_dir.close(io);
    var store: store_module.Store = .{ .dir = document_dir, .basename = basename };
    const config: http.Config = .{ .static_dir = static_dir, .store = &store, .port = options.port };
    const address = try Io.net.IpAddress.parseIp4("127.0.0.1", options.port);
    var listener = try address.listen(io, .{ .reuse_address = true });
    defer listener.deinit(io);
    std.log.info("listening on http://127.0.0.1:{d} (document: {s}, static: {s})", .{ options.port, options.document_path, options.static_path });
    var group: Io.Group = .init;
    defer group.cancel(io);
    while (true) {
        const stream = listener.accept(io) catch |err| {
            std.log.err("accept failed: {t}", .{err});
            continue;
        };
        group.concurrent(io, http.handleConnection, .{ io, init.gpa, config, stream }) catch {
            http.handleConnection(io, init.gpa, config, stream);
        };
    }
}

test "CLI defaults and explicit options" {
    const options = try parseArgs(&.{ "serve", "notes.json" });
    try std.testing.expectEqual(@as(u16, 4545), options.port);
    try std.testing.expectEqualStrings("dist", options.static_path);
    const explicit = try parseArgs(&.{ "serve", "notes.json", "--port", "9000", "--static", "client/public" });
    try std.testing.expectEqual(@as(u16, 9000), explicit.port);
    try std.testing.expectEqualStrings("client/public", explicit.static_path);
}

test "CLI rejects missing and invalid arguments" {
    try std.testing.expectError(error.InvalidArguments, parseArgs(&.{}));
    try std.testing.expectError(error.InvalidArguments, parseArgs(&.{ "serve", "notes.json", "--port" }));
    try std.testing.expectError(error.InvalidPort, parseArgs(&.{ "serve", "notes.json", "--port", "0" }));
    try std.testing.expectError(error.InvalidArguments, parseArgs(&.{ "serve", "notes.json", "--unknown", "x" }));
}

test {
    _ = @import("schema.zig");
    _ = @import("store.zig");
    _ = @import("http.zig");
}
