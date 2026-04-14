// import crypto from 'crypto';

// export function signHmacSha256(params: Record<string, any>, secretKey: string): Record<string, any> {
//   const searchParams = new URLSearchParams();

//   Object.entries(params).forEach(([key, value]) => {
//     if (value !== undefined && value !== null) {
//       searchParams.append(key, String(value));
//     }
//   });

//   const signature = crypto.createHmac('sha256', secretKey).update(searchParams.toString()).digest('hex');

//   return { ...params, signature };
// }

import crypto from "crypto";

export function signHmacSha256(
  params: Record<string, any>,
  secretKey: string,
): {
  signedParams: Record<string, any>;
  queryString: string;
  signedQueryString: string;
  signature: string;
} {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      searchParams.append(key, String(value));
    }
  }

  const queryString = searchParams.toString();

  const signature = crypto
    .createHmac("sha256", secretKey)
    .update(queryString)
    .digest("hex");

  return {
    signedParams: { ...params, signature },
    queryString,
    signedQueryString: `${queryString}&signature=${signature}`,
    signature,
  };
}
