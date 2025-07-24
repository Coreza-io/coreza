import axios, { AxiosRequestConfig } from 'axios';
import { createError } from '../middleware/errorHandler';

export interface HttpInput {
  method?: string;
  url: string;
  auth_type?: string;
  bearer_token?: string;
  basic_username?: string;
  basic_password?: string;
  api_key_location?: string;
  api_key_name?: string;
  api_key_value?: string;
  headers?: Array<{ key: string; value: string }>;
  body_type?: string;
  json_body?: any;
  form_data?: Array<{ key: string; value: string }>;
  raw_body?: string;
  timeout?: number;
}

export interface HttpResult {
  success: boolean;
  status?: number;
  statusText?: string;
  headers?: any;
  data?: any;
  error?: string;
}

export class HttpService {
  static async makeRequest(input: HttpInput): Promise<HttpResult> {
    try {
      const {
        method = 'GET',
        url,
        auth_type = 'none',
        bearer_token,
        basic_username,
        basic_password,
        api_key_location,
        api_key_name,
        api_key_value,
        headers = [],
        body_type = 'none',
        json_body,
        form_data = [],
        raw_body,
        timeout = 30
      } = input;

      if (!url) {
        throw createError('URL is required', 400);
      }

      // Build request configuration
      const config: AxiosRequestConfig = {
        method: method.toLowerCase(),
        url,
        timeout: timeout * 1000,
        headers: {}
      };

      // Add custom headers
      if (Array.isArray(headers)) {
        headers.forEach((header: any) => {
          if (header.key && header.value) {
            config.headers![header.key] = header.value;
          }
        });
      }

      // Handle authentication
      switch (auth_type) {
        case 'bearer':
          if (bearer_token) {
            config.headers!['Authorization'] = `Bearer ${bearer_token}`;
          }
          break;
        case 'basic':
          if (basic_username && basic_password) {
            const auth = Buffer.from(`${basic_username}:${basic_password}`).toString('base64');
            config.headers!['Authorization'] = `Basic ${auth}`;
          }
          break;
        case 'api_key':
          if (api_key_name && api_key_value) {
            if (api_key_location === 'header') {
              config.headers![api_key_name] = api_key_value;
            } else if (api_key_location === 'query') {
              config.params = { ...config.params, [api_key_name]: api_key_value };
            }
          }
          break;
      }

      // Handle request body for methods that support it
      if (['post', 'put', 'patch'].includes(method.toLowerCase())) {
        switch (body_type) {
          case 'json':
            if (json_body) {
              config.data = typeof json_body === 'string' ? JSON.parse(json_body) : json_body;
              config.headers!['Content-Type'] = 'application/json';
            }
            break;
          case 'form':
            if (Array.isArray(form_data)) {
              const formData = new URLSearchParams();
              form_data.forEach((field: any) => {
                if (field.key && field.value) {
                  formData.append(field.key, field.value);
                }
              });
              config.data = formData;
              config.headers!['Content-Type'] = 'application/x-www-form-urlencoded';
            }
            break;
          case 'raw':
            if (raw_body) {
              config.data = raw_body;
              config.headers!['Content-Type'] = 'text/plain';
            }
            break;
        }
      }

      // Make the HTTP request
      const response = await axios(config);

      return {
        success: true,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        data: response.data
      };

    } catch (error: any) {
      console.error('HTTP request error:', error);
      
      if (axios.isAxiosError(error)) {
        return {
          success: false,
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          error: error.message
        };
      } else {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  }

  static async execute(input: HttpInput): Promise<HttpResult> {
    return this.makeRequest(input);
  }
}