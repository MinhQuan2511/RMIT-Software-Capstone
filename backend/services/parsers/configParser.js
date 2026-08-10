/**
 * Robot / Network Setup Configuration Parser
 * Parses 'Cfig' JSON format.
 * Extracts 'RobotPose' (x, y, z, alfa, beta, gamma, theta) and 'robotinfo' (IP, Port, Modbus configuration).
 */
function parseCfigConfig(jsonText) {
  const defaultConfig = {
    RobotPose: {
      x: 0,
      y: 0,
      z: 0,
      alfa: 0,
      beta: 0,
      gamma: 0,
      theta: 0,
    },
    robotinfo: {
      IP: "192.168.1.100",
      Port: 7001,
      modbusConfig: {
        slaveId: 1,
        baudRate: 115200,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
      },
    },
  };

  if (!jsonText || typeof jsonText !== 'string') {
    return defaultConfig;
  }

  try {
    const parsed = JSON.parse(jsonText);
    const result = { ...defaultConfig };

    if (parsed.RobotPose || parsed.robotPose || parsed.robot_pose) {
      const pose = parsed.RobotPose || parsed.robotPose || parsed.robot_pose;
      result.RobotPose = {
        x: Number(pose.x ?? pose.X ?? 0),
        y: Number(pose.y ?? pose.Y ?? 0),
        z: Number(pose.z ?? pose.Z ?? 0),
        alfa: Number(pose.alfa ?? pose.alpha ?? 0),
        beta: Number(pose.beta ?? 0),
        gamma: Number(pose.gamma ?? 0),
        theta: Number(pose.theta ?? 0),
      };
    }

    if (parsed.robotinfo || parsed.robotInfo || parsed.robot_info) {
      const info = parsed.robotinfo || parsed.robotInfo || parsed.robot_info;
      result.robotinfo = {
        IP: String(info.IP || info.ip || defaultConfig.robotinfo.IP),
        Port: Number(info.Port || info.port || defaultConfig.robotinfo.Port),
        modbusConfig: info.modbusConfig || info.modbus || defaultConfig.robotinfo.modbusConfig,
      };
    }

    return result;
  } catch (err) {
    console.warn("Failed to parse JSON for Cfig config, returning default configuration:", err.message);
    return defaultConfig;
  }
}

module.exports = {
  parseCfigConfig
};
