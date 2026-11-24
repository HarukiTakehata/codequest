FROM docker.io/library/alpine:3.22

RUN sed -i 's|https://dl-cdn.alpinelinux.org/alpine|https://mirrors.tuna.tsinghua.edu.cn/alpine|g' /etc/apk/repositories \
    && apk add --no-cache build-base cmake gdb git vim nano \
    && adduser -D -u 1000 student \
    && mkdir -p /workspace \
    && chown student:student /workspace

USER student
WORKDIR /workspace
ENV HOME=/home/student CC=gcc CXX=g++
CMD ["/bin/sh"]
