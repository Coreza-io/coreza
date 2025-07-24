import express from 'express';
import axios, { AxiosRequestConfig } from 'axios';

const router = express.Router();

// HTTP Request handler
router.post('/request', async (req, res) => {
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
    } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
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

    res.json({
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      data: response.data
    });

  } catch (error) {
    console.error('HTTP request error:', error);
    
    if (axios.isAxiosError(error)) {
      res.status(error.response?.status || 500).json({
        error: 'HTTP request failed',
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message
      });
    } else {
      res.status(500).json({
        error: 'Failed to make HTTP request',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
});

export default router;