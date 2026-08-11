import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { SCREENS } from "../../app/_lib/screens";

const APP_ROOT = join(process.cwd(), "app", "(app)");

function pageFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return pageFiles(path);
    return entry.name === "page.tsx" ? [path] : [];
  });
}

/**
 * App Routerのroute groupはURLに出ず、動的詳細はSCREENSでは親prefixを登録する。
 * 例: app/(app)/vehicle/[vehicleNo]/page.tsx -> /vehicle
 */
function inventoryHref(pageFile: string): string {
  const segments = relative(APP_ROOT, pageFile)
    .split(sep)
    .slice(0, -1)
    .filter((segment) => !segment.startsWith("["));
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

describe("内部画面inventory", () => {
  it("実在する全page.tsxとSCREENSが双方向に一致する", () => {
    const fileSystemRoutes = pageFiles(APP_ROOT).map(inventoryHref).sort();
    const registeredRoutes = SCREENS.map((screen) => screen.href).sort();

    expect(registeredRoutes).toEqual(fileSystemRoutes);
    expect(registeredRoutes).toHaveLength(23);
  });

  it("表示画面25面とredirect alias 1本の構成を固定する", () => {
    const visibleExternalSurfaces = ["/sign-in", "not-found"] as const;
    const redirectAliases = ["/reset-password"] as const;

    expect(SCREENS.length + visibleExternalSurfaces.length).toBe(25);
    expect(redirectAliases).toHaveLength(1);
  });
});
