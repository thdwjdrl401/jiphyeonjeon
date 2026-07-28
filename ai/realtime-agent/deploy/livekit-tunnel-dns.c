#define _GNU_SOURCE

#include <dlfcn.h>
#include <netdb.h>
#include <stdlib.h>
#include <string.h>

typedef int (*getaddrinfo_fn)(const char *, const char *, const struct addrinfo *,
                             struct addrinfo **);

int getaddrinfo(const char *node, const char *service, const struct addrinfo *hints,
                struct addrinfo **result) {
    static getaddrinfo_fn real_getaddrinfo;
    const char *tunnel_host;

    if (real_getaddrinfo == NULL) {
        *(void **)(&real_getaddrinfo) = dlsym(RTLD_NEXT, "getaddrinfo");
        if (real_getaddrinfo == NULL) {
            return EAI_SYSTEM;
        }
    }

    tunnel_host = getenv("LIVEKIT_TUNNEL_HOST");
    if (node != NULL && tunnel_host != NULL && tunnel_host[0] != '\0' &&
        strcmp(node, tunnel_host) == 0) {
        return real_getaddrinfo("127.0.0.1", service, hints, result);
    }
    return real_getaddrinfo(node, service, hints, result);
}
