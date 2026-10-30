# Backend connection failure in market quotes

The reported browser error is net::ERR_CONNECTION_REFUSED at port 8000. It occurs
before the backend route or Yahoo is reached. Dashboard workflow cards can still
load through direct Supabase reads while this API is offline. Logs from market-stream-service do
not establish that the separate backend API is listening. A Binance clock-sync
timeout in that service is unrelated to this failed HTTP connection.

Implement typed frontend error states for unreachable backend, API timeout,
HTTP/auth/route failures and provider quote unavailability. Keep the existing
provider implementation. Session calculation continues locally while quote access
is unavailable. Details expose the actionable API error and a shared retry action.
Do not invent quote values or rewrite the configured backend URL.

Local recovery:
1. In coreza-backend, start the API using npm run dev and confirm its API listen
   message/port. Keep market-stream-service running separately when needed.
2. If the API uses a different host/port, set frontend VITE_BACKEND_URL to that
   reachable API address and restart the frontend. localhost refers to the browser
   machine; remote devices need a reachable server address.
3. Click the session badge for quote details and Retry quotes after API recovery.
   An HTTP/auth/provider error after connection succeeds is a separate diagnosis.

This PR improves accurate failure handling; it cannot start the user's local API
from this workspace. No provider, execution, subscription, calendar or DB changes.
No automated tests added/run. Frontend type-check/build are performed; actual
backend recovery and provider/browser verification remain local deployment checks.
