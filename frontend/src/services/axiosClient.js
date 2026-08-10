import axios from "axios";

const axiosClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api",
  headers: {
    "Content-Type": "application/json",
  },
});

// Setup interceptors for common error handling or logging if needed
axiosClient.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error("API Error Response:", error);
    return Promise.reject(error);
  }
);

export default axiosClient;
