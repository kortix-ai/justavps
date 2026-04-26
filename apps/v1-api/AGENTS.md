# JustAVPS V1 API Boundary

This folder is the standalone legacy API service boundary.

The web app must not mount V1 API/server code directly. It should proxy API traffic to this service.

Keep this service boring while V2 is being built:

- preserve existing V1 behavior
- do not rewrite V1 business logic unless required for the split
- keep compatibility routes stable
- move legacy server modules here incrementally after the runtime split is green
