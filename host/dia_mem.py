#!/usr/bin/python3
"""Native messaging host: reports memory footprint of Dia processes."""
import json, re, struct, subprocess, sys
from pathlib import Path

UNITS = {"B": 1 / 2**20, "K": 1 / 1024, "M": 1, "G": 1024}
CLIENT_ID = re.compile(r"--renderer-client-id=(\d+)")
PROC_TYPE = re.compile(r"--type=(\S+)")
DIA_DATA = Path.home() / "Library/Application Support/Dia/User Data"
EXTENSION_ID = re.compile(r"[a-p]{32}")


def proc_kind(cmd):
    proc_type = PROC_TYPE.search(cmd)
    if not proc_type:
        return "app"
    if proc_type[1] == "renderer":
        return "extensions" if "--extension-process" in cmd else "tabs"
    return "gpu" if proc_type[1] == "gpu-process" else "services"


def dia_procs():
    """pid -> (renderer client id or None, kind). The client id is the processId webNavigation reports."""
    out = subprocess.run(["ps", "-axo", "pid=,command="], capture_output=True, text=True).stdout
    procs = {}
    for line in out.splitlines():
        pid, cmd = line.split(None, 1)
        if "/Applications/Dia.app/" in cmd:
            match = CLIENT_ID.search(cmd)
            procs[int(pid)] = (match and match[1], proc_kind(cmd))
    return procs


def dia_pids():
    return set(dia_procs())


def snapshot():
    pids = dia_procs()
    out = subprocess.run(["top", "-l", "1", "-stats", "pid,mem"], capture_output=True, text=True).stdout
    procs = {}
    for line in out.splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[0].isdigit() and int(parts[0]) in pids:
            mem = parts[1].rstrip("+-")
            procs[parts[0]] = round(float(mem[:-1]) * UNITS.get(mem[-1], 1))
    renderers, kinds = {}, {}
    for pid, mb in procs.items():
        client_id, kind = pids[int(pid)]
        if client_id:
            renderers[client_id] = mb
        kinds.setdefault(kind, {"mb": 0, "count": 0})
        kinds[kind]["mb"] += mb
        kinds[kind]["count"] += 1
    return {"total_mb": sum(procs.values()), "procs": procs, "renderers": renderers, "kinds": kinds}


def theme_color(profile_dir):
    try:
        argb = json.loads((profile_dir / "Preferences").read_text())["browser"]["theme"]["user_color2"]
        return f"#{argb & 0xFFFFFF:06X}"
    except (OSError, ValueError, KeyError, TypeError):
        return None


def profiles(ext_id, marker):
    """Dia profiles with theme colors; `current` is the one whose extension storage holds the marker."""
    info = json.loads((DIA_DATA / "Local State").read_text())["profile"]["info_cache"]
    found, current = [], None
    for name, meta in info.items():
        found.append({"dir": name, "name": meta.get("name") or name, "color": theme_color(DIA_DATA / name)})
        if marker and EXTENSION_ID.fullmatch(ext_id or ""):
            # Writes to chrome.storage.local land in the profile's LevelDB log right away.
            logs = (DIA_DATA / name / "Local Extension Settings" / ext_id).glob("*.log")
            if any(marker.encode() in log.read_bytes() for log in logs):
                current = name
    return {"profiles": sorted(found, key=lambda p: p["name"].lower()), "current": current}


def handle(req):
    if req.get("cmd") == "snapshot":
        return snapshot()
    if req.get("cmd") == "profiles":
        try:
            return profiles(req.get("id"), req.get("marker"))
        except (OSError, ValueError, KeyError) as e:
            return {"error": str(e)}
    return {"pids": sorted(dia_pids())}


def main():
    # Serves requests until the extension disconnects (one-shot callers just send one).
    while len(header := sys.stdin.buffer.read(4)) == 4:
        data = json.dumps(handle(json.loads(sys.stdin.buffer.read(struct.unpack("<I", header)[0])))).encode()
        sys.stdout.buffer.write(struct.pack("<I", len(data)) + data)
        sys.stdout.buffer.flush()


if __name__ == "__main__":
    main()
