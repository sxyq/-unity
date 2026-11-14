# x86_64 Linux 上运行 32 位 Unity 客户端，只为产出 Player.log
FROM debian:bookworm
ENV DEBIAN_FRONTEND=noninteractive \
    WINEPREFIX=/wine \
    WINEDEBUG=-all \
    DISPLAY=:99 \
    LIBGL_ALWAYS_SOFTWARE=1

RUN dpkg --add-architecture i386 \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      wine wine32:i386 wine64 xvfb x11-utils libgl1-mesa-dri \
 && rm -rf /var/lib/apt/lists/*

COPY run.sh /run.sh
RUN chmod +x /run.sh
WORKDIR /app
CMD ["/run.sh"]
