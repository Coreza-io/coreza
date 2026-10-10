import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useSafeExpressionHelpers } from "@/hooks/useSafeExpressionHelpers";
let mockToken = "first";
const mockGet = jest.fn();
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ session: { access_token: mockToken } }) }));
jest.mock("@/lib/apiClient", () => ({ apiClient: { get: (...args: unknown[]) => mockGet(...args) } }));
let supported = true;
function Harness() { supported = useSafeExpressionHelpers(); return null; }
const response = (value: unknown) => ({ ok: true, json: async () => value });
const capability = { safe_expression_helpers: { lastN: { contract_version: 1, scope: "typed-edit-fields-v2" } } };

test("ignores stale session responses and requires the matching version and scope", async () => {
  let first!: (value: unknown) => void;
  mockGet.mockImplementationOnce(() => new Promise(resolve => { first = resolve; })).mockResolvedValueOnce(response({}));
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(React.createElement(Harness)); }); expect(supported).toBe(false);
  mockToken = "second";
  await act(async () => { renderer.update(React.createElement(Harness)); }); expect(supported).toBe(false);
  await act(async () => { first(response(capability)); }); expect(supported).toBe(false);
  mockToken = "third"; mockGet.mockResolvedValueOnce(response(capability));
  await act(async () => { renderer.update(React.createElement(Harness)); }); expect(supported).toBe(true);
  mockToken = "fourth"; mockGet.mockResolvedValueOnce(response({ safe_expression_helpers: { lastN: { contract_version: 2, scope: "typed-edit-fields-v2" } } }));
  await act(async () => { renderer.update(React.createElement(Harness)); }); expect(supported).toBe(false);
  act(() => renderer.unmount());
});
