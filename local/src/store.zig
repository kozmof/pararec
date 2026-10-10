const std = @import("std");
const builtin = @import("builtin");
const schema = @import("schema.zig");
const Io = std.Io;
const Allocator = std.mem.Allocator;

pub const ETag = [34]u8;

pub fn etag(bytes: []const u8) ETag {
    var digest: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(bytes, &digest, .{});
    var result: ETag = undefined;
    result[0] = '"';
    result[33] = '"';
    const alphabet = "0123456789abcdef";
    for (digest[0..16], 0..) |byte, index| {
        result[1 + index * 2] = alphabet[byte >> 4];
        result[2 + index * 2] = alphabet[byte & 15];
    }
    return result;
}

pub const Precondition = union(enum) {
    create,
    exists,
    match: []const u8,

    pub fn check(self: Precondition, current: ?[]const u8) bool {
        return switch (self) {
            .create => current == null,
            .exists => current != null,
            .match => |expected| if (current) |bytes| std.mem.eql(u8, expected, &etag(bytes)) else false,
        };
    }
};

pub const Document = struct {
    bytes: []u8,
    tag: ETag,
    pub fn deinit(self: Document, gpa: Allocator) void {
        gpa.free(self.bytes);
    }
};

pub const Store = struct {
    dir: Io.Dir,
    basename: []const u8,
    mutex: Io.Mutex = .init,

    pub fn read(self: *Store, io: Io, gpa: Allocator) !Document {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        const bytes = try self.dir.readFileAlloc(io, self.basename, gpa, .limited(schema.max_document_size));
        return .{ .bytes = bytes, .tag = etag(bytes) };
    }

    pub fn put(self: *Store, io: Io, gpa: Allocator, document: schema.Schema, precondition: Precondition) !ETag {
        return self.putImpl(io, gpa, document, precondition, .none);
    }

    const Fault = union(enum) { none, before_replace, after_replace, after_check: *const fn (Io, Io.Dir, []const u8) anyerror!void };

    fn putImpl(self: *Store, io: Io, gpa: Allocator, document: schema.Schema, precondition: Precondition, fault: Fault) !ETag {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        try schema.validate(gpa, document);
        const current = self.dir.readFileAlloc(io, self.basename, gpa, .limited(schema.max_document_size)) catch |err| switch (err) {
            error.FileNotFound => null,
            else => return err,
        };
        defer if (current) |bytes| gpa.free(bytes);
        if (!precondition.check(current)) return error.PreconditionFailed;
        if (fault == .after_check) try fault.after_check(io, self.dir, self.basename);

        const bytes = try schema.serialize(gpa, document);
        defer gpa.free(bytes);
        if (current) |old| {
            const backup = try std.mem.concat(gpa, u8, &.{ self.basename, ".bak" });
            defer gpa.free(backup);
            try writeAtomic(self.dir, io, backup, old, true);
        }

        var file = try self.dir.createFileAtomic(io, self.basename, .{ .replace = current != null });
        defer file.deinit(io);
        try file.file.writeStreamingAll(io, bytes);
        try file.file.sync(io);
        if (fault == .before_replace) return error.InjectedWriteFailure;
        if (current != null) {
            try file.replace(io);
        } else {
            // First creation also guards against a file appearing after the check.
            file.link(io) catch |err| switch (err) {
                error.PathAlreadyExists => return error.PreconditionFailed,
                else => return err,
            };
        }
        if (fault == .after_replace) return error.SaveOutcomeUncertain;
        syncDir(self.dir, io) catch return error.SaveOutcomeUncertain;
        return etag(bytes);
    }
};

fn writeAtomic(dir: Io.Dir, io: Io, path: []const u8, bytes: []const u8, replace: bool) !void {
    var file = try dir.createFileAtomic(io, path, .{ .replace = replace });
    defer file.deinit(io);
    try file.file.writeStreamingAll(io, bytes);
    try file.file.sync(io);
    if (replace) try file.replace(io) else try file.link(io);
    try syncDir(dir, io);
}

fn syncDir(dir: Io.Dir, io: Io) !void {
    // These platforms support fsync on an opened directory handle.
    switch (builtin.os.tag) {
        .linux, .macos, .freebsd, .openbsd, .netbsd, .dragonfly => {
            const file: Io.File = .{ .handle = dir.handle, .flags = .{ .nonblocking = false } };
            try file.sync(io);
        },
        else => {},
    }
}

test "ETag is a quoted SHA-256 prefix" {
    try std.testing.expectEqualStrings("\"e3b0c44298fc1c149afbf4c8996fb924\"", &etag(""));
}

test "conditional creation, update, and one-generation backup" {
    var tmp = std.testing.tmpDir(.{ .iterate = true });
    defer tmp.cleanup();
    const io = std.testing.io;
    const gpa = std.testing.allocator;
    var store: Store = .{ .dir = tmp.dir, .basename = "document.json" };
    const empty: schema.Schema = .{ .version = 1, .root = &.{} };
    const first = try store.put(io, gpa, empty, .create);
    try std.testing.expectError(error.PreconditionFailed, store.put(io, gpa, empty, .create));
    try std.testing.expectError(error.PreconditionFailed, store.put(io, gpa, empty, .{ .match = &etag("stale") }));
    const loaded = try store.read(io, gpa);
    defer loaded.deinit(gpa);
    try std.testing.expectEqual(first, loaded.tag);
    _ = try store.put(io, gpa, empty, .{ .match = &first });
    const backup = try tmp.dir.readFileAlloc(io, "document.json.bak", gpa, .unlimited);
    defer gpa.free(backup);
    try std.testing.expectEqualStrings(loaded.bytes, backup);
}

test "failure before rename preserves original and after rename is uncertain" {
    var tmp = std.testing.tmpDir(.{ .iterate = true });
    defer tmp.cleanup();
    const io = std.testing.io;
    const gpa = std.testing.allocator;
    var store: Store = .{ .dir = tmp.dir, .basename = "document.json" };
    const old = "{\"version\":1,\"root\":[]}\n";
    try tmp.dir.writeFile(io, .{ .sub_path = "document.json", .data = old });
    const empty: schema.Schema = .{ .version = 1, .root = &.{} };
    try std.testing.expectError(error.InjectedWriteFailure, store.putImpl(io, gpa, empty, .{ .match = &etag(old) }, .before_replace));
    const unchanged = try store.read(io, gpa);
    defer unchanged.deinit(gpa);
    try std.testing.expectEqualStrings(old, unchanged.bytes);
    try std.testing.expectError(error.SaveOutcomeUncertain, store.putImpl(io, gpa, empty, .{ .match = &etag(old) }, .after_replace));
    const replaced = try store.read(io, gpa);
    defer replaced.deinit(gpa);
    try std.testing.expect(!std.mem.eql(u8, old, replaced.bytes));
    const parsed = try schema.parse(gpa, replaced.bytes);
    defer parsed.deinit();
    try schema.validate(gpa, parsed.value);
}

test "backup failure leaves the original untouched" {
    var tmp = std.testing.tmpDir(.{ .iterate = true });
    defer tmp.cleanup();
    const io = std.testing.io;
    const gpa = std.testing.allocator;
    var store: Store = .{ .dir = tmp.dir, .basename = "document.json" };
    const old = "{\"version\":1,\"root\":[]}\n";
    try tmp.dir.writeFile(io, .{ .sub_path = "document.json", .data = old });
    try tmp.dir.createDir(io, "document.json.bak", .default_dir);
    const empty: schema.Schema = .{ .version = 1, .root = &.{} };
    if (store.put(io, gpa, empty, .{ .match = &etag(old) })) |_| return error.ExpectedBackupFailure else |_| {}
    const loaded = try store.read(io, gpa);
    defer loaded.deinit(gpa);
    try std.testing.expectEqualStrings(old, loaded.bytes);
}

fn simulateExternalWrite(io: Io, dir: Io.Dir, basename: []const u8) !void {
    try dir.writeFile(io, .{ .sub_path = basename, .data = "external process wrote this" });
}

test "external updates after the check are outside the mutex guarantee" {
    var tmp = std.testing.tmpDir(.{ .iterate = true });
    defer tmp.cleanup();
    const io = std.testing.io;
    const gpa = std.testing.allocator;
    var store: Store = .{ .dir = tmp.dir, .basename = "document.json" };
    const empty: schema.Schema = .{ .version = 1, .root = &.{} };
    const first = try store.put(io, gpa, empty, .create);
    const second = try store.putImpl(io, gpa, empty, .{ .match = &first }, .{ .after_check = simulateExternalWrite });
    const loaded = try store.read(io, gpa);
    defer loaded.deinit(gpa);
    try std.testing.expectEqual(second, loaded.tag);
    try std.testing.expect(!std.mem.eql(u8, loaded.bytes, "external process wrote this"));
}

test "a file appearing after the creation check is not replaced" {
    var tmp = std.testing.tmpDir(.{ .iterate = true });
    defer tmp.cleanup();
    const io = std.testing.io;
    const gpa = std.testing.allocator;
    var store: Store = .{ .dir = tmp.dir, .basename = "document.json" };
    const empty: schema.Schema = .{ .version = 1, .root = &.{} };
    try std.testing.expectError(error.PreconditionFailed, store.putImpl(io, gpa, empty, .create, .{ .after_check = simulateExternalWrite }));
    const loaded = try store.read(io, gpa);
    defer loaded.deinit(gpa);
    try std.testing.expectEqualStrings("external process wrote this", loaded.bytes);
}
