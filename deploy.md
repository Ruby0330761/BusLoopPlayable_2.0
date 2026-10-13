# Bus Loop Playable Editor Deployment

## Service

- Project: `bus-loop-playable-editor`
- Container port: `5173`
- Runtime: Node.js 22 with a prebuilt Vite editor, preview middleware, and FFmpeg-backed pre-roll compression
- Container limits: 2 GB memory and 1 CPU
- Health endpoint: `/`

The image builds the remote editor into `server-dist` once during Docker image
creation, then serves it with Vite preview at runtime. Preview middleware keeps
level authoring, Unity import, conveyor authoring, playable export, and package
validation APIs available without the memory cost of a development server.
The image uses Debian slim, the smaller Chromium headless shell, and excludes
unused source assets. Python and the verified playable checker remain included
so platform package export and runtime validation stay available on the server.

## Persistence

Editor data is stored under `/data/bus-loop-playable-editor` on the host:

- `artifacts/`: authored levels, backups, selected level, and the generated
  Unity level catalog updated by remote imports
- `artifacts/editor-backgrounds/`: custom backgrounds added from the editor
- `artifacts/editor-prerolls/`: custom MP4 pre-roll videos and their display-name metadata

Custom pre-roll uploads are transcoded by FFmpeg to browser-compatible H.264/AAC
MP4s (maximum compressed size 2 MB). Existing legacy videos are migrated when
the editor lists them, and the exporter applies the same conversion as a final
guard.

Remote export downloads are generated under the container's temporary storage
and removed after each response, so exported packages do not accumulate in the
persistent volume.

The first deployment seeds these paths from the image. Later deployments reuse
the same data and port.

## Start

```bash
sh start.sh <host-port>
```

The service is intended for the internal network. It does not include user
authentication; anyone who can reach the URL can edit shared level data.
