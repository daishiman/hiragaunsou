/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

import { DriverMasterManager } from "../../app/(app)/admin/driver-master/DriverMasterManager";
import { VehicleMasterManager } from "../../app/(app)/admin/vehicle-master/VehicleMasterManager";

function expectNonOverlappingStickyStack(container: HTMLElement) {
  const step = container.querySelector<HTMLElement>('[data-sticky="step"]');
  const filter = container.querySelector<HTMLElement>('[data-sticky="filter"]');

  expect(step).not.toBeNull();
  expect(filter).not.toBeNull();
  expect(step).toHaveAttribute("data-sticky-top", "header");
  expect(filter).toHaveAttribute("data-sticky-below", "stepHeader");
  expect(step).toHaveClass(
    "top-[var(--app-header-h)]",
    "h-[var(--screen-step-header-h)]",
  );
  expect(filter).toHaveClass(
    "top-[calc(var(--app-header-h)+var(--screen-step-header-h))]",
  );
  expect(step?.compareDocumentPosition(filter!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
}

describe("マスタ画面のsticky積層", () => {
  it("車両マスタでは工程ヘッダーの下に絞り込みを積む", () => {
    const { container } = render(
      <VehicleMasterManager initialVehicles={[]} yearMonth="2026-05" />,
    );
    expectNonOverlappingStickyStack(container);
  });

  it("運転者マスタでは工程ヘッダーの下に絞り込みを積む", () => {
    const { container } = render(
      <DriverMasterManager initialDrivers={[]} vehicleNos={[]} yearMonth="2026-05" />,
    );
    expectNonOverlappingStickyStack(container);
  });
});
