/* nofile-shim.c — test-environment workaround (see README.md in this dir).
 *
 * neard (the near-sandbox binary) raises RLIMIT_NOFILE to 65535 at startup
 * and exits if that fails. This VM's container caps the hard fd limit at
 * 4096 and forbids raising it, so the sandbox can never start here.
 * This shim pretends the RLIMIT_NOFILE raise succeeded; the sandbox test
 * workload uses far fewer than 4096 fds, so nothing real is lost.
 * Only RLIMIT_NOFILE is faked — every other resource passes through to the
 * real libc function. The binary calls the *64 variants, so all of
 * setrlimit/setrlimit64/prlimit/prlimit64 are covered.
 * Build with: gcc -shared -fPIC -o nofile-shim.so nofile-shim.c -ldl
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stddef.h>
#include <sys/resource.h>
#include <sys/types.h>

typedef int (*setrlimit_fn)(__rlimit_resource_t, const struct rlimit *);
typedef int (*prlimit_fn)(pid_t, __rlimit_resource_t, const struct rlimit *,
                          struct rlimit *);

static setrlimit_fn real_setrlimit(const char *name) {
    return (setrlimit_fn)dlsym(RTLD_NEXT, name);
}

int setrlimit(__rlimit_resource_t resource, const struct rlimit *rlim) {
    if (resource == RLIMIT_NOFILE) {
        return 0;
    }
    return real_setrlimit("setrlimit")(resource, rlim);
}

int setrlimit64(__rlimit_resource_t resource, const struct rlimit64 *rlim) {
    if (resource == RLIMIT_NOFILE) {
        return 0;
    }
    return real_setrlimit("setrlimit64")(resource, (const struct rlimit *)rlim);
}

int prlimit(pid_t pid, __rlimit_resource_t resource, const struct rlimit *new_limit,
            struct rlimit *old_limit) {
    if (resource == RLIMIT_NOFILE && new_limit != NULL) {
        if (old_limit != NULL) {
            getrlimit(resource, old_limit);
        }
        return 0;
    }
    static prlimit_fn real_prlimit = NULL;
    if (real_prlimit == NULL) {
        real_prlimit = (prlimit_fn)dlsym(RTLD_NEXT, "prlimit");
    }
    return real_prlimit(pid, resource, new_limit, old_limit);
}

int prlimit64(pid_t pid, __rlimit_resource_t resource, const struct rlimit64 *new_limit,
              struct rlimit64 *old_limit) {
    if (resource == RLIMIT_NOFILE && new_limit != NULL) {
        if (old_limit != NULL) {
            getrlimit64(resource, old_limit);
        }
        return 0;
    }
    static prlimit_fn real_prlimit64 = NULL;
    if (real_prlimit64 == NULL) {
        real_prlimit64 = (prlimit_fn)dlsym(RTLD_NEXT, "prlimit64");
    }
    return real_prlimit64(pid, resource, (const struct rlimit *)new_limit,
                          (struct rlimit *)old_limit);
}
