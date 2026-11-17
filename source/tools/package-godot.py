"""Finish an existing Godot export with the canonical local model gateway."""
from pathlib import Path
import shutil
import subprocess
import sys

root = Path('/Volumes/Lexar/Project/医院仿真')
platform = sys.argv[1]
if platform == 'macOS':
    product = Path('/Volumes/HospitalTools/Products/TractionCare.app')
    product.parent.mkdir(parents=True, exist_ok=True)
    if product.exists():
        shutil.rmtree(product)
    subprocess.run(['ditto', '-xk', str(root/'builds/macOS/TractionCare.zip'), str(product.parent)], check=True)
    exported = [p for p in product.parent.glob('*.app') if p != product]
    if exported:
        exported[0].rename(product)
    gateway = product/'Contents/Resources/Gateway'
else:
    product = root/'builds/Windows/TractionCare.exe'
    gateway = product.parent/'Gateway'
gateway.mkdir(parents=True, exist_ok=True)
binary = 'node' if platform == 'macOS' else 'node.exe'
for name in [binary, 'LICENSE']:
    shutil.copy2(root/'work/gateway'/platform/name, gateway/name)
shutil.copy2(root/'source/apps/model-gateway/server.mjs', gateway/'server.mjs')
if platform == 'macOS':
    (gateway/binary).chmod(0o755)
    plist = product/'Contents/Info.plist'
    subprocess.run(['/usr/libexec/PlistBuddy', '-c', 'Add :NSRemovableVolumesUsageDescription string 读取外置固态盘中的护理课程、模型及学习记录。', str(plist)], check=True)
    subprocess.run(['/usr/bin/codesign', '--force', '--deep', '--sign', '-', str(product)], check=True)
    archive = root/'builds/macOS/TractionCare.zip'
    subprocess.run(['ditto', '-c', '-k', '--keepParent', str(product), str(archive)], check=True)
print('PACKAGED', product)
