# kortix-justavps-v2

OpenAPI-generated Python SDK for the JustAVPS V2 API.

```python
from justavps_v2 import JustAVPSV2

client = JustAVPSV2(base_url="http://localhost:4200", token="...")
print(client.get_machines())
print(client.post_machines_by_id_exec("machine-id", body={"command": "uname -a"}))
```
