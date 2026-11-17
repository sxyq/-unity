#!/usr/bin/env python3
"""macOS foreground build CPU budget, including child processes. No scheduler."""
import json
import os
import resource
import signal
import subprocess
import sys
import time

command = sys.argv[1:]
started = time.monotonic()
pid = os.fork()
if pid == 0:
    os.setsid()
    os.nice(10)
    os.kill(os.getpid(), signal.SIGSTOP)
    os.execvp(command[0], command)
os.waitpid(pid, os.WUNTRACED)
tracked = {pid}
usage = {}
last_wall = started
last_cpu = 0
cycle_cpu = 0
peak_cpu = 0
peak_rss = 0

def signal_tree(sig):
    try:
        os.killpg(pid, sig)
    except (ProcessLookupError, PermissionError):
        pass
    for child in tracked - {pid}:
        try:
            os.kill(child, sig)
        except ProcessLookupError:
            pass

def read_usage():
    global tracked
    rows = [line.split() for line in subprocess.check_output(['ps', '-axo', 'pid=,ppid=,pgid=,time=,rss='], text=True).splitlines()]
    for _ in range(8):
        children = {int(p) for p, parent, group, clock, memory in rows if int(parent) in tracked or int(group) == pid}
        if children <= tracked:
            break
        tracked |= children
    rss = 0
    for child, parent, group, clock, memory in rows:
        if int(child) in tracked:
            minutes, seconds = clock.rsplit(':', 1)
            usage[int(child)] = int(minutes) * 60 + float(seconds)
            rss += int(memory) * 1024
    return sum(usage.values()), rss

try:
    while True:
        finished, status, final_usage = os.wait4(pid, os.WNOHANG)
        if finished:
            break
        cycle_wall = time.monotonic()
        signal_tree(signal.SIGCONT)
        time.sleep(0.01)
        signal_tree(signal.SIGSTOP)
        cpu, rss = read_usage()
        own = resource.getrusage(resource.RUSAGE_SELF)
        cpu += own.ru_utime + own.ru_stime
        peak_rss = max(peak_rss, rss)
        # Leave CPU headroom for the foreground monitor below the 80% total budget.
        debt = (cpu - cycle_cpu) / 0.50 - (time.monotonic() - cycle_wall)
        cycle_cpu = cpu
        if debt > 0:
            time.sleep(debt)
        wall = time.monotonic()
        if wall - last_wall >= 5:
            sample = 100 * (cpu - last_cpu) / (wall - last_wall)
            peak_cpu = max(peak_cpu, sample)
            print(json.dumps({'build_cpu_percent_one_core': round(sample, 2), 'rss_mib': round(rss / 1048576), 'seconds': round(wall-started)}), flush=True)
            last_wall, last_cpu = wall, cpu
finally:
    signal_tree(signal.SIGCONT)
    if 'status' not in locals() or not finished:
        signal_tree(signal.SIGTERM)
elapsed = time.monotonic() - started
own = resource.getrusage(resource.RUSAGE_SELF)
total_cpu = max(cycle_cpu, final_usage.ru_utime + final_usage.ru_stime + own.ru_utime + own.ru_stime)
peak_rss = max(peak_rss, final_usage.ru_maxrss)
average_cpu = 100 * total_cpu / elapsed
print(json.dumps({'peak_sample_cpu_percent_one_core': round(max(peak_cpu, average_cpu), 2), 'average_cpu_percent_one_core': round(average_cpu, 2), 'peak_tree_rss_mib': round(peak_rss / 1048576), 'elapsed_seconds': round(elapsed, 2)}), flush=True)
sys.exit(os.waitstatus_to_exitcode(status))
