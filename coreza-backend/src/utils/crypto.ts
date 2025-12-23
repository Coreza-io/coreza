import crypto from 'crypto';

export function signHmacSha256(params: Record<string, any>, secretKey: string): Record<string, any> {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      searchParams.append(key, String(value));
    }
  });

  const signature = crypto.createHmac('sha256', secretKey).update(searchParams.toString()).digest('hex');

  return { ...params, signature };
}
