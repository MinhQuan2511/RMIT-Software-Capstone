import axios from "axios";

const axiosClient = axios.create({
  baseURL: typeof window !== "undefined" 
    ? `${window.location.origin}/api` 
    : "http://localhost:3000/api",
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
