const std = @import("std");

pub const Content = struct { id: []const u8, text: []const u8 };
pub const RightContent = struct { id: []const u8, text: []const u8, children: []const Container };
pub const Container = struct { id: []const u8, left: []const Content, right: RightContent };
pub const Schema = struct { version: u32, root: []const Container };
pub const max_body_size = 16 * 1024 * 1024;

pub fn parse(gpa: std.mem.Allocator, bytes: []const u8) !std.json.Parsed(Schema) {
    if (!std.unicode.utf8ValidateSlice(bytes)) return error.InvalidUtf8;
    if (std.mem.startsWith(u8, bytes, "\xef\xbb\xbf")) return error.UnexpectedBom;
    return std.json.parseFromSlice(Schema, gpa, bytes, .{ .ignore_unknown_fields = true });
}

pub fn validate(gpa: std.mem.Allocator, document: Schema) !void {
    if (document.version != 1) return error.UnsupportedVersion;
    var ids: std.StringHashMap(void) = .init(gpa);
    defer ids.deinit();
    var pending: std.ArrayList([]const Container) = .empty;
    defer pending.deinit(gpa);
    try pending.append(gpa, document.root);
    while (pending.pop()) |level| {
        for (level) |container| {
            try addId(&ids, container.id);
            if (container.left.len == 0) return error.EmptyLeft;
            if (std.mem.eql(u8, container.id, container.right.id)) return error.RightIdMatchesContainer;
            for (container.left) |content| {
                try addId(&ids, content.id);
                try checkText(content.text);
            }
            try addId(&ids, container.right.id);
            try checkText(container.right.text);
            try pending.append(gpa, container.right.children);
        }
    }
}

fn addId(ids: *std.StringHashMap(void), id: []const u8) !void {
    const entry = try ids.getOrPut(id);
    if (entry.found_existing) return error.DuplicateId;
}

fn checkText(text: []const u8) !void {
    if (std.mem.indexOfScalar(u8, text, '\r') != null) return error.CarriageReturn;
}

pub fn serialize(gpa: std.mem.Allocator, document: Schema) ![]u8 {
    const json = try std.json.Stringify.valueAlloc(gpa, document, .{ .whitespace = .indent_2 });
    defer gpa.free(json);
    return std.mem.concat(gpa, u8, &.{ json, "\n" });
}

const valid =
    \\{"version":1,"root":[{"id":"row","left":[{"id":"left","text":"日本語 👩🏽‍💻\\nsecond"}],"right":{"id":"right","text":"","children":[]}}]}
;

test "schema accepts recursive documents and drops unknown fields" {
    const parsed = try parse(std.testing.allocator, valid);
    defer parsed.deinit();
    try validate(std.testing.allocator, parsed.value);
    const with_unknown = try parse(std.testing.allocator, "{\"version\":1,\"root\":[],\"future\":true}");
    defer with_unknown.deinit();
    try validate(std.testing.allocator, with_unknown.value);
    const bytes = try serialize(std.testing.allocator, with_unknown.value);
    defer std.testing.allocator.free(bytes);
    try std.testing.expectEqualStrings("{\n  \"version\": 1,\n  \"root\": []\n}\n", bytes);
}

test "schema rejects each invariant violation" {
    const cases = .{
        .{ "{\"version\":2,\"root\":[]}", error.UnsupportedVersion },
        .{ "{\"version\":1,\"root\":[{\"id\":\"r\",\"left\":[],\"right\":{\"id\":\"b\",\"text\":\"\",\"children\":[]}}]}", error.EmptyLeft },
        .{ "{\"version\":1,\"root\":[{\"id\":\"r\",\"left\":[{\"id\":\"a\",\"text\":\"\"}],\"right\":{\"id\":\"r\",\"text\":\"\",\"children\":[]}}]}", error.RightIdMatchesContainer },
        .{ "{\"version\":1,\"root\":[{\"id\":\"r\",\"left\":[{\"id\":\"a\",\"text\":\"\"}],\"right\":{\"id\":\"a\",\"text\":\"\",\"children\":[]}}]}", error.DuplicateId },
        .{ "{\"version\":1,\"root\":[{\"id\":\"r\",\"left\":[{\"id\":\"a\",\"text\":\"\\r\"}],\"right\":{\"id\":\"b\",\"text\":\"\",\"children\":[]}}]}", error.CarriageReturn },
    };
    inline for (cases) |case| {
        const parsed = try parse(std.testing.allocator, case[0]);
        defer parsed.deinit();
        try std.testing.expectError(case[1], validate(std.testing.allocator, parsed.value));
    }
}

test "schema rejects invalid UTF-8 and missing fields" {
    try std.testing.expectError(error.InvalidUtf8, parse(std.testing.allocator, "\xff"));
    try std.testing.expectError(error.UnexpectedBom, parse(std.testing.allocator, "\xef\xbb\xbf{\"version\":1,\"root\":[]}"));
    try std.testing.expectError(error.MissingField, parse(std.testing.allocator, "{\"version\":1}"));
}
