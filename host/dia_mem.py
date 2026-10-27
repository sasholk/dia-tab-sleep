#!/usr/bin/python3
"""Native messaging host: reports memory footprint of Dia processes."""
import json, struct, subprocess, sys

UNITS = {"B": 1 / 2**20, "K": 1 / 1024, "M": 1, "G": 1024}


def dia_pids():
    out = subprocess.run(["ps", "-axo", "pid=,command="], capture_output=True, text=True).stdout
    return {int(l.split(None, 1)[0]) for l in out.splitlines() if "/Applications/Dia.app/" in l}


def snapshot():
    pids = dia_pids()
    out = subprocess.run(["top", "-l", "1", "-stats", "pid,mem"], capture_output=True, text=True).stdout
    procs = {}
    for line in out.splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[0].isdigit() and int(parts[0]) in pids:
            mem = parts[1].rstrip("+-")
            procs[parts[0]] = round(float(mem[:-1]) * UNITS.get(mem[-1], 1))
    return {"total_mb": sum(procs.values()), "procs": procs}


def main():
    # Serves requests until the extension disconnects (one-shot callers just send one).
    while len(header := sys.stdin.buffer.read(4)) == 4:
        cmd = json.loads(sys.stdin.buffer.read(struct.unpack("<I", header)[0])).get("cmd")
        reply = snapshot() if cmd == "snapshot" else {"pids": sorted(dia_pids())}
        data = json.dumps(reply).encode()
        sys.stdout.buffer.write(struct.pack("<I", len(data)) + data)
        sys.stdout.buffer.flush()


if __name__ == "__main__":
    main()
