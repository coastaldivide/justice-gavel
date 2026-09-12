# Justice Gavel API — Developer SDK Guide

Any programming language can integrate with Justice Gavel via our REST API.
The OpenAPI 3.0 spec at `openapi.json` enables auto-generated clients for 12+ languages.

## Authentication

All endpoints (except public ones) require a JWT bearer token.

```
POST https://api.justicegavel.app/api/auth/login
Content-Type: application/json

{ "email": "user@example.com", "password": "..." }
→ { "token": "eyJ...", "refresh_token": "eyJ..." }
```

Use the token in every request: `Authorization: Bearer eyJ...`

## Generate a client for your language

```bash
# Install the generator (one time)
npm install -g @openapitools/openapi-generator-cli

# Generate client for your language
node scripts/generate-sdk.mjs python      # → sdk/python/
node scripts/generate-sdk.mjs typescript  # → sdk/typescript/
node scripts/generate-sdk.mjs java        # → sdk/java/
node scripts/generate-sdk.mjs go          # → sdk/go/
node scripts/generate-sdk.mjs swift       # → sdk/swift/
node scripts/generate-sdk.mjs kotlin      # → sdk/kotlin/
node scripts/generate-sdk.mjs ruby        # → sdk/ruby/
node scripts/generate-sdk.mjs php         # → sdk/php/
node scripts/generate-sdk.mjs csharp      # → sdk/csharp/
node scripts/generate-sdk.mjs rust        # → sdk/rust/
node scripts/generate-sdk.mjs dart        # → sdk/dart/ (Flutter)
```

## Direct API examples (no SDK needed)

### Python
```python
import requests

BASE = "https://api.justicegavel.app/api"
token = requests.post(f"{BASE}/auth/login",
    json={"email":"...", "password":"..."}).json()["token"]

lawyers = requests.get(f"{BASE}/match",
    params={"lat": 36.16, "lng": -86.78, "case_type": "DUI"},
    headers={"Authorization": f"Bearer {token}"}).json()
```

### JavaScript / Node.js
```javascript
const BASE = 'https://api.justicegavel.app/api';

const { token } = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: '...', password: '...' }),
}).then(r => r.json());

const lawyers = await fetch(`${BASE}/match?lat=36.16&lng=-86.78&case_type=DUI`, {
  headers: { Authorization: `Bearer ${token}` },
}).then(r => r.json());
```

### Go
```go
resp, _ := http.Get("https://api.justicegavel.app/api/match?lat=36.16&lng=-86.78")
defer resp.Body.Close()
var lawyers []map[string]interface{}
json.NewDecoder(resp.Body).Decode(&lawyers)
```

### Swift / iOS (native Xcode)
```swift
var request = URLRequest(url: URL(string: "https://api.justicegavel.app/api/match?lat=36.16&lng=-86.78")!)
request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
let (data, _) = try await URLSession.shared.data(for: request)
let lawyers = try JSONDecoder().decode([Lawyer].self, from: data)
```

### Kotlin / Android (native)
```kotlin
val client = OkHttpClient()
val request = Request.Builder()
    .url("https://api.justicegavel.app/api/match?lat=36.16&lng=-86.78")
    .addHeader("Authorization", "Bearer $token")
    .build()
val response = client.newCall(request).execute()
```

### Java
```java
HttpClient client = HttpClient.newHttpClient();
HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("https://api.justicegavel.app/api/match?lat=36.16&lng=-86.78"))
    .header("Authorization", "Bearer " + token)
    .build();
HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
```

### Ruby
```ruby
require 'net/http'
require 'json'

uri = URI('https://api.justicegavel.app/api/match?lat=36.16&lng=-86.78')
req = Net::HTTP::Get.new(uri)
req['Authorization'] = "Bearer #{token}"
res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true) { |h| h.request(req) }
lawyers = JSON.parse(res.body)
```

### PHP
```php
$ch = curl_init('https://api.justicegavel.app/api/match?lat=36.16&lng=-86.78');
curl_setopt($ch, CURLOPT_HTTPHEADER, ["Authorization: Bearer $token"]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$lawyers = json_decode(curl_exec($ch), true);
```

### C#
```csharp
var client = new HttpClient();
client.DefaultRequestHeaders.Authorization = 
    new AuthenticationHeaderValue("Bearer", token);
var lawyers = await client.GetFromJsonAsync<List<Lawyer>>(
    "https://api.justicegavel.app/api/match?lat=36.16&lng=-86.78");
```

### Rust
```rust
let client = reqwest::Client::new();
let lawyers: Vec<serde_json::Value> = client
    .get("https://api.justicegavel.app/api/match")
    .query(&[("lat","36.16"), ("lng","-86.78")])
    .bearer_auth(&token)
    .send().await?.json().await?;
```

### Dart / Flutter
```dart
final response = await http.get(
  Uri.parse('https://api.justicegavel.app/api/match?lat=36.16&lng=-86.78'),
  headers: {'Authorization': 'Bearer $token'},
);
final lawyers = jsonDecode(response.body);
```

## Key endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/auth/login` | POST | Get JWT token |
| `/api/match` | GET | Match lawyers by location + case type |
| `/api/bail` | GET | Bail calculator |
| `/api/chat/stream` | POST | AI chat (streaming SSE) |
| `/api/expungement/check` | POST | Expungement eligibility |
| `/api/arrests/search` | GET | Public arrest record search |
| `/api/billing/bondsman/tiers` | GET | Bondsman subscription tiers |
| `/api/checkins/submit` | POST | Defendant GPS check-in |
| `/api/translate/message` | POST | Live translation (14 languages) |

Full spec: `openapi.json` (394 documented endpoints)
