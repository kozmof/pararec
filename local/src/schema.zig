const std = @import("std");

pub const Content = struct { id: []const u8, text: []const u8 };
pub const RightContent = struct { id: []const u8, text: []const u8, children: []const Container };
pub const Container = struct { id: []const u8, left: []const Content, right: RightContent };
pub const WidthRate = struct { left: f64, right: f64 };
pub const Config = struct {
    showTitles: bool = true,
    maxWidth: f64 = 1100,
    outerWidthRate: WidthRate = .{ .left = 35, .right = 65 },
    innerIdthRate: WidthRate = .{ .left = 35, .right = 65 },
};
pub const Schema = struct {
    version: u32,
    title: []const u8 = "document",
    config: Config = .{},
    root: []const Container,
};

pub fn defaultTitle(filename: []const u8) []const u8 {
    const basename = std.fs.path.basename(filename);
    return basename[0 .. basename.len - std.fs.path.extension(basename).len];
}
pub const max_document_size = 512 * 1024 * 1024;
pub const max_body_size = max_document_size;

pub fn parse(gpa: std.mem.Allocator, bytes: []const u8) !std.json.Parsed(Schema) {
    if (!std.unicode.utf8ValidateSlice(bytes)) return error.InvalidUtf8;
    if (std.mem.startsWith(u8, bytes, "\xef\xbb\xbf")) return error.UnexpectedBom;
    return std.json.parseFromSlice(Schema, gpa, bytes, .{ .ignore_unknown_fields = true });
}

pub fn validate(gpa: std.mem.Allocator, document: Schema) !void {
    if (document.version != 1) return error.UnsupportedVersion;
    if (!std.math.isFinite(document.config.maxWidth) or document.config.maxWidth <= 0) return error.InvalidMaxWidth;
    try checkText(document.title);
    for ([_]WidthRate{ document.config.outerWidthRate, document.config.innerIdthRate }) |rate| {
        if (!std.math.isFinite(rate.left) or !std.math.isFinite(rate.right) or rate.left <= 0 or rate.right <= 0) return error.InvalidWidthRate;
    }
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
    const json = try std.json.Stringify.valueAlloc(gpa, document, .{ .whitespace = .indent_2, .emit_null_optional_fields = false });
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
    const reparsed = try parse(std.testing.allocator, bytes);
    defer reparsed.deinit();
    try std.testing.expectEqualStrings("document", reparsed.value.title);
    try std.testing.expect(reparsed.value.config.showTitles);
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

test "document settings survive serialization and validate ratios" {
    const parsed = try parse(std.testing.allocator, "{\"version\":1,\"root\":[],\"title\":\"Notes\",\"config\":{\"showTitles\":false,\"outerWidthRate\":{\"left\":2,\"right\":3},\"innerIdthRate\":{\"left\":1,\"right\":4}}}");
    defer parsed.deinit();
    try validate(std.testing.allocator, parsed.value);
    const bytes = try serialize(std.testing.allocator, parsed.value);
    defer std.testing.allocator.free(bytes);
    const roundtrip = try parse(std.testing.allocator, bytes);
    defer roundtrip.deinit();
    try std.testing.expectEqualStrings("Notes", roundtrip.value.title);
    try std.testing.expectEqual(false, roundtrip.value.config.showTitles);
    try std.testing.expectEqual(@as(f64, 4), roundtrip.value.config.innerIdthRate.right);
    try std.testing.expectError(error.InvalidWidthRate, validate(std.testing.allocator, .{ .version = 1, .root = &.{}, .config = .{ .outerWidthRate = .{ .left = 0, .right = 1 } } }));
    try std.testing.expectEqualStrings("my.notes", defaultTitle("/tmp/my.notes.json"));
    try std.testing.expectEqualStrings("notes", defaultTitle("notes"));
}

test "maxWidth defaults and validation" {
    const parsed = try parse(std.testing.allocator, "{\"version\":1,\"root\":[],\"config\":{\"maxWidth\":900}}");
    defer parsed.deinit();
    try validate(std.testing.allocator, parsed.value);
    const bytes = try serialize(std.testing.allocator, parsed.value);
    defer std.testing.allocator.free(bytes);
    const roundtrip = try parse(std.testing.allocator, bytes);
    defer roundtrip.deinit();
    try std.testing.expectEqual(@as(f64, 900), roundtrip.value.config.maxWidth);
    try std.testing.expectEqual(@as(f64, 1100), (Config{}).maxWidth);
    for ([_]f64{ 0, -1, std.math.inf(f64), std.math.nan(f64) }) |width| {
        try std.testing.expectError(error.InvalidMaxWidth, validate(std.testing.allocator, .{ .version = 1, .root = &.{}, .config = .{ .maxWidth = width } }));
    }
}
