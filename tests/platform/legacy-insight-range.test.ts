import {describe,it,expect} from "vitest";
import {legacyInsightRange} from "../../src/platform/legacy-insight-range.js";
describe("bounded explicit account-calendar insight ranges",()=>{
 it("preserves inclusive leap-day dates and leaves presets alone when absent",()=>{expect(legacyInsightRange({since:"2024-02-29",until:"2024-03-01"},undefined)).toBe('{"since":"2024-02-29","until":"2024-03-01"}');expect(legacyInsightRange(undefined,"today")).toBeUndefined();});
 it.each([null,[],{}, {since:"2025-02-29",until:"2025-03-01"},{since:"2024-02-30",until:"2024-03-01"},{since:"2024-01-01T00:00:00Z",until:"2024-01-02"},{since:"2024-01-02",until:"2024-01-01"},{since:"2020-01-01",until:"2026-01-01"},{since:"2024-01-01",until:"2024-01-01",access_token:"forbidden"}])("rejects malformed, ambiguous or unbounded input %#",value=>{expect(()=>legacyInsightRange(value,undefined)).toThrow();});
 it("rejects competing preset and explicit range instead of guessing precedence",()=>{expect(()=>legacyInsightRange({since:"2024-01-01",until:"2024-01-01"},"today")).toThrow("PRESET_CONFLICT");});
});
