import "./setup";
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App";

const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  window.history.replaceState(null, "", "/");
  localStorage.clear();
});

describe("dashboard interactions", () => {
  test("loads once and only reruns the query after an explicit action", async () => {
    const urls: string[] = [];
    const mockFetch = (input: RequestInfo | URL): Promise<Response> => {
      const url = requestUrl(input);
      urls.push(url);
      if (url.startsWith("/health")) return Promise.resolve(json({ status: "ok" }));
      if (url.startsWith("/logs/aggregate")) {
        return Promise.resolve(
          json({
            buckets: [
              { start: "2026-08-15T11:00:00.000Z", group: "info", count: 8 },
              { start: "2026-08-15T11:00:00.000Z", group: "error", count: 2 },
            ],
          }),
        );
      }
      return Promise.resolve(
        json({
          logs: [
            {
              id: "01800000-0000-7000-8000-000000000000",
              timestamp: "2026-08-15T11:00:00.000Z",
              level: "error",
              service: "checkout",
              message: "payment failed",
              attributes: { region: "eu" },
            },
          ],
          next_cursor: null,
        }),
      );
    };
    globalThis.fetch = mockFetch as typeof fetch;

    const view = render(<App />);
    expect(await view.findByText("payment failed")).toBeDefined();
    const initialCalls = urls.length;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(urls).toHaveLength(initialCalls);

    const serviceInput = view.getByLabelText("Service") as HTMLInputElement;
    const user = userEvent.setup({ document: window.document });
    await user.type(serviceInput, "checkout");
    expect(serviceInput.value).toBe("checkout");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(urls).toHaveLength(initialCalls);

    await user.click(view.getByRole("button", { name: "Apply filters" }));
    await waitFor(() => expect(urls.length).toBeGreaterThan(initialCalls));
    expect(window.location.search).toContain("service=checkout");
  });

  test("restores filters from the URL and changes chart grouping explicitly", async () => {
    window.history.replaceState(null, "", "/?range=24h&service=auth&group_by=level");
    const mockFetch = (input: RequestInfo | URL): Promise<Response> => {
      const url = requestUrl(input);
      if (url.startsWith("/health")) return Promise.resolve(json({ status: "ok" }));
      if (url.startsWith("/logs/aggregate")) return Promise.resolve(json({ buckets: [] }));
      return Promise.resolve(json({ logs: [], next_cursor: null }));
    };
    globalThis.fetch = mockFetch as typeof fetch;
    const view = render(<App />);
    expect((view.getByLabelText("Service") as HTMLInputElement).value).toBe("auth");
    fireEvent.click(view.getByRole("button", { name: "Service" }));
    await waitFor(() => expect(window.location.search).toContain("group_by=service"));
  });

  test("reuses the original rolling range when loading a cursor page", async () => {
    const logUrls: string[] = [];
    let logRequest = 0;
    const mockFetch = (input: RequestInfo | URL): Promise<Response> => {
      const url = requestUrl(input);
      if (url.startsWith("/health")) return Promise.resolve(json({ status: "ok" }));
      if (url.startsWith("/logs/aggregate")) return Promise.resolve(json({ buckets: [] }));
      logUrls.push(url);
      logRequest += 1;
      return Promise.resolve(
        json({
          logs: [
            {
              id: `01800000-0000-7000-8000-${String(logRequest).padStart(12, "0")}`,
              timestamp: "2026-08-15T11:00:00.000Z",
              level: "info",
              service: "api",
              message: `page ${String(logRequest)}`,
              attributes: {},
            },
          ],
          next_cursor: logRequest === 1 ? "cursor-page-two" : null,
        }),
      );
    };
    globalThis.fetch = mockFetch as typeof fetch;

    const view = render(<App />);
    await view.findByText("page 1");
    await new Promise((resolve) => setTimeout(resolve, 25));
    const user = userEvent.setup({ document: window.document });
    await user.click(view.getByRole("button", { name: "Load older logs" }));
    await view.findByText("page 2");

    const first = new URL(logUrls[0] ?? "", "http://localhost");
    const second = new URL(logUrls[1] ?? "", "http://localhost");
    expect(second.searchParams.get("cursor")).toBe("cursor-page-two");
    expect(second.searchParams.get("since")).toBe(first.searchParams.get("since"));
    expect(second.searchParams.get("until")).toBe(first.searchParams.get("until"));
  });
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.toString() : input.url;
}
