import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseSwiftErrors } from '../../src/evaluator/swift-error-parser.ts';

describe('SwiftErrorParser', () => {
  test('extracts single compiler error with file, line, and message', () => {
    const rawLog = `
CompileSwift normal arm64 /Users/test/Sources/ContentView.swift
/Users/test/Sources/ContentView.swift:42:15: error: cannot find 'InvalidButton' in scope
    InvalidButton()
    ^~~~~~~~~~~~~
** BUILD FAILED **
`;
    const errors = parseSwiftErrors(rawLog);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].file, '/Users/test/Sources/ContentView.swift');
    assert.equal(errors[0].line, 42);
    assert.equal(errors[0].column, 15);
    assert.equal(errors[0].message, "cannot find 'InvalidButton' in scope");
  });

  test('extracts multiple distinct compiler errors', () => {
    const rawLog = `
/App/Model.swift:10:5: error: expected identifier in property declaration
/App/ContentView.swift:20:12: error: value of type 'State' has no member 'count'
`;
    const errors = parseSwiftErrors(rawLog);
    assert.equal(errors.length, 2);
    assert.equal(errors[0].file, '/App/Model.swift');
    assert.equal(errors[1].file, '/App/ContentView.swift');
  });

  test('returns empty array when build succeeds with no errors', () => {
    const rawLog = `
** BUILD SUCCEEDED **
`;
    const errors = parseSwiftErrors(rawLog);
    assert.equal(errors.length, 0);
  });
});
