import axios from "axios";

import { API_BASE_URL } from "@/lib/api";

export const axiosInstance = axios.create({
  baseURL: `${API_BASE_URL}/api/v1`,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});
