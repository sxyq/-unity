#!/bin/zsh
set -e
image='/Volumes/Lexar/Project/医院仿真/toolchain/HospitalTools.sparsebundle'
if [[ ! -d /Volumes/HospitalTools/Applications ]]; then
  diskutil image attach --nobrowse "$image"
fi
case "${1:-godot}" in
  unity) open '/Volumes/HospitalTools/Applications/Unity/6000.0.85f2/Unity.app' ;;
  hub) open '/Volumes/HospitalTools/Applications/Unity Hub.app' ;;
  godot) exec '/Volumes/HospitalTools/Godot/Godot.app/Contents/MacOS/Godot' --path '/Volumes/Lexar/Project/医院仿真/godot-rebuild' ;;
  app) open '/Volumes/HospitalTools/Products/TractionCare.app' ;;
esac
