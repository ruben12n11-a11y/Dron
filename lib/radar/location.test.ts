import { describe, expect, it, vi } from "vitest";

import { readForegroundLocation } from "./location";

describe("readForegroundLocation", () => {
  it("solicita permiso en primer plano y entrega una posición válida", async () => {
    const getPermission = vi
      .fn()
      .mockResolvedValueOnce({ granted: false, canAskAgain: true });
    const requestPermission = vi
      .fn()
      .mockResolvedValue({ granted: true, canAskAgain: true });
    const getPosition = vi.fn().mockResolvedValue({
      latitude: 40.4168,
      longitude: -3.7038,
      accuracy: 18,
    });

    await expect(
      readForegroundLocation({ getPermission, requestPermission, getPosition }),
    ).resolves.toEqual({
      status: "located",
      latitude: 40.4168,
      longitude: -3.7038,
      accuracy: 18,
    });
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(getPosition).toHaveBeenCalledOnce();
  });

  it("devuelve el estado de denegación y no lee ni aplica una posición", async () => {
    const getPermission = vi
      .fn()
      .mockResolvedValue({ granted: false, canAskAgain: true });
    const requestPermission = vi
      .fn()
      .mockResolvedValue({ granted: false, canAskAgain: false });
    const getPosition = vi.fn();

    await expect(
      readForegroundLocation({ getPermission, requestPermission, getPosition }),
    ).resolves.toEqual({ status: "denied", canAskAgain: false });
    expect(getPosition).not.toHaveBeenCalled();
  });

  it("rechaza coordenadas fuera de rango", async () => {
    const client = {
      getPermission: vi.fn().mockResolvedValue({ granted: true, canAskAgain: true }),
      requestPermission: vi.fn(),
      getPosition: vi
        .fn()
        .mockResolvedValue({ latitude: 91, longitude: -122.4, accuracy: null }),
    };

    await expect(readForegroundLocation(client)).resolves.toEqual({
      status: "invalid",
    });
  });
});
