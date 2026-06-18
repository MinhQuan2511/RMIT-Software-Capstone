import axiosClient from "./axiosClient";

export const robotStudioApi = {
  getBridgeStatus: async () => {
    // Simulated latency
    await new Promise((resolve) => setTimeout(resolve, 300));
    return {
      status: "Offline",
      connected: false,
      ipAddress: "192.168.125.1",
      controllerType: "IRC5 Single"
    };
  },

  syncPath: async (rapidCode) => {
    // Simulated upload of ABB RAPID program module
    await new Promise((resolve) => setTimeout(resolve, 800));
    return {
      success: true,
      synced: true,
      moduleName: "MainModule",
      linesUploaded: rapidCode.split("\n").length,
      crc: "0xAB4F2D"
    };
  }
};
