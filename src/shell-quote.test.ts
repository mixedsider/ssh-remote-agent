import { describe, expect, it } from "bun:test";
import { shellQuote } from "./shell-quote.ts";

describe("shellQuote", () => {
  it("wraps a simple word in single quotes when given a plain token", () => {
    // Given a plain word / When quoted / Then it is single-quoted
    expect(shellQuote("hello")).toBe("'hello'");
  });

  it("preserves spaces by keeping them inside the single quotes", () => {
    expect(shellQuote("hello world")).toBe("'hello world'");
  });

  it("neutralizes double quotes by wrapping in single quotes", () => {
    expect(shellQuote('say "hi"')).toBe("'say \"hi\"'");
  });

  it("neutralizes shell metacharacters $ backtick and semicolon", () => {
    expect(shellQuote("$(rm -rf /) `whoami`; echo x")).toBe("'$(rm -rf /) `whoami`; echo x'");
  });

  it("escapes an embedded single quote using the '\\'' idiom", () => {
    // Given a value containing a single quote
    // When quoted
    // Then the single quote is emitted as '\'' (close, escaped quote, reopen)
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });

  it("escapes multiple single quotes independently", () => {
    // "''" → open ' + ('\'') + ('\'') + close ' = ''\'''\'''
    expect(shellQuote("''")).toBe("''\\'''\\'''");
  });

  it("keeps newlines literally inside the single quotes", () => {
    expect(shellQuote("line1\nline2")).toBe("'line1\nline2'");
  });

  it("quotes an empty string as an empty single-quoted pair", () => {
    expect(shellQuote("")).toBe("''");
  });
});
