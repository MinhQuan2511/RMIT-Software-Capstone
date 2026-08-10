import axiosClient from "./axiosClient";

export const tracerStudioApi = {
  getCameraStatus: async () => {
    // Simulated API call latency
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { 
      status: "Standby", 
      connected: true,
      deviceId: "TRACER-3D-V2",
      exposure: 12.5
    };
  },
  
  triggerCalibration: async (targetType, squareSize, tcp) => {
    // Mock triggering a hand-eye calibration cycle
    await new Promise((resolve) => setTimeout(resolve, 750));
    return {
      success: true,
      pointsCaptured: 12,
      reprojectionError: 0.142, // mm
      timestamp: new Date().toISOString(),
      matrix: [
        [0.9998, 0.0012, -0.0154, 150.25],
        [-0.0011, 0.9999, 0.0084, -50.12],
        [0.0154, -0.0084, 0.9998, 200.45],
        [0, 0, 0, 1]
      ]
    };
  }
};
