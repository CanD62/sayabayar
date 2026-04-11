# Mirror Docker Hub Images ke Private Registry

> Tujuan: Menghilangkan ketergantungan ke Docker Hub (`registry-1.docker.io`)
> agar deploy via Drone tidak gagal saat Docker Hub timeout/down.

## Registry Target

```
registry.pcs.my.id
```

---

## Step 1: Login ke Private Registry

```bash
docker login registry.pcs.my.id
```

---

## Step 2: Pull, Tag, Push

Jalankan di mesin yang bisa akses Docker Hub (Mac lokal / VPS yang internetnya lancar):

### drone-ssh (dipakai Drone CI sebagai step runner)

```bash
docker pull appleboy/drone-ssh
docker tag appleboy/drone-ssh registry.pcs.my.id/drone-ssh:latest
docker push registry.pcs.my.id/drone-ssh:latest
```

### node:20-alpine (dipakai untuk pnpm install, prisma, dan run API)

```bash
docker pull node:20-alpine
docker tag node:20-alpine registry.pcs.my.id/node:20-alpine
docker push registry.pcs.my.id/node:20-alpine
```

### redis:7-alpine (dipakai di docker-compose)

```bash
docker pull redis:7-alpine
docker tag redis:7-alpine registry.pcs.my.id/redis:7-alpine
docker push registry.pcs.my.id/redis:7-alpine
```

---

## Step 3: Update Config Files

### `.drone.yml`

```diff
 steps:
   - name: deploy to production
-    image: appleboy/drone-ssh
+    image: registry.pcs.my.id/drone-ssh:latest
```

```diff
-        NODE_IMAGE="node:20-alpine"
+        NODE_IMAGE="registry.pcs.my.id/node:20-alpine"
```

### `docker-compose.yml`

```diff
-    image: redis:7-alpine
+    image: registry.pcs.my.id/redis:7-alpine
```

---

## Step 4: Pastikan Drone Runner Bisa Akses Registry

Drone runner harus bisa pull dari `registry.pcs.my.id`. Tambahkan di
Drone runner environment (biasanya di `/etc/drone-runner-docker/config`
atau docker-compose runner):

```
DRONE_RUNNER_VOLUMES=/root/.docker/config.json:/root/.docker/config.json
```

Atau set di Drone server `.env`:

```
DRONE_DOCKER_CONFIG=/root/.docker/config.json
```

Pastikan `docker login registry.pcs.my.id` sudah dijalankan di host runner,
sehingga `/root/.docker/config.json` berisi credentials.

---

## Step 5: Update Berkala

Kalau butuh update image (misal node upgrade ke 22), ulangi Step 2:

```bash
docker pull node:22-alpine
docker tag node:22-alpine registry.pcs.my.id/node:22-alpine
docker push registry.pcs.my.id/node:22-alpine
```

Lalu update `NODE_IMAGE` di `.drone.yml`.

---

## Checklist

- [ ] `appleboy/drone-ssh` → `registry.pcs.my.id/drone-ssh:latest`
- [ ] `node:20-alpine` → `registry.pcs.my.id/node:20-alpine`
- [ ] `redis:7-alpine` → `registry.pcs.my.id/redis:7-alpine`
- [ ] Update `.drone.yml`
- [ ] Update `docker-compose.yml`
- [ ] Test deploy ulang via Drone
