// Keep the *video* across a full-page navigation, without copying it.
//
// # Why this is separate from `workinprogress.ts`
//
// That module saves the subtitles, and its own comment explains why it
// deliberately does not save the video: a `File` does not survive a
// navigation, an object URL is a pointer into a destroyed document, and
// copying the bytes into IndexedDB would mean silently writing someone's
// video to disk -- the one thing this product promises not to do.
//
// All of that is still true. What that reasoning missed is that there is a
// third option: store a **handle** rather than the bytes.
//
// A `FileSystemFileHandle` is structured-cloneable, so IndexedDB can hold
// it. It is a *reference* to a file the user already chose -- a few dozen
// bytes of bookkeeping, no copy of the footage anywhere. After the tab is
// destroyed and rebuilt, `requestPermission()` asks the user to confirm and
// `getFile()` hands back the same `File`. The video never moves, and the
// browser -- not this code -- guards access to it.
//
// This matters because the thing that destroys the tab is *our own sign-in
// button*. A user who pressed "sign in" to pay for a translation lost the
// video they were about to translate, and had to find it on disk again.
// The subtitles came back; the video did not; the burn section vanished
// with it, because it is gated on the video's dimensions. From the user's
// side that reads as "I signed in and the app broke."
//
// # Where it does not work
//
// The File System Access API is Chromium-only today. Firefox and Safari
// get the old behaviour -- subtitles back, video re-picked by hand -- so
// every caller has to treat a restored video as a bonus, never a promise.
// `videoHandlesWork()` says which world we are in so the interface can
// offer the right thing instead of a button that does nothing.
//
// # Why the handle is not silently reopened
//
// Chromium will re-grant read access without a prompt in some cases and
// prompt in others. Either way the app asks first, with a button. Reaching
// back into someone's filesystem on page load -- even for a file they
// chose a minute ago -- is not something to do unannounced.

const DB = "opensubs";
const STORE = "handles";
const KEY = "video";

/** Whether this browser can store and re-open a file handle at all. */
export function videoHandlesWork(): boolean {
  return (
    typeof indexedDB !== "undefined" &&
    typeof window !== "undefined" &&
    "showOpenFilePicker" in window
  );
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = body(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

export async function rememberVideo(handle: FileSystemFileHandle): Promise<void> {
  if (!videoHandlesWork()) return;
  try {
    await run("readwrite", (store) => store.put(handle, KEY));
  } catch {
    // A private window, blocked site data, or a browser that will not
    // clone this handle. Losing the convenience must never break the
    // picker that produced it.
  }
}

export async function rememberedVideo(): Promise<FileSystemFileHandle | null> {
  if (!videoHandlesWork()) return null;
  try {
    const handle = await run<FileSystemFileHandle | undefined>("readonly", (store) =>
      store.get(KEY),
    );
    return handle ?? null;
  } catch {
    return null;
  }
}

export async function forgetVideo(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    await run("readwrite", (store) => store.delete(KEY));
  } catch {
    // See rememberVideo.
  }
}

/**
 * Turn a stored handle back into a `File`, asking the user if needed.
 *
 * Returns `null` when they decline, or when the file has been moved,
 * renamed or deleted since -- all of which are ordinary, and none of which
 * deserve an error. The caller falls back to asking for the file again.
 *
 * `requestPermission` must be called from a user gesture, so this is only
 * ever reached from a click.
 */
export async function reopenVideo(handle: FileSystemFileHandle): Promise<File | null> {
  try {
    const query = (handle as FileSystemHandleWithPermissions).queryPermission;
    if (query && (await query.call(handle, { mode: "read" })) !== "granted") {
      const request = (handle as FileSystemHandleWithPermissions).requestPermission;
      if (!request) return null;
      if ((await request.call(handle, { mode: "read" })) !== "granted") return null;
    }
    return await handle.getFile();
  } catch {
    return null;
  }
}

/**
 * Pick a video, keeping the handle when the browser offers one.
 *
 * Returns `null` if the user cancelled. Throws only for real failures,
 * which the caller surfaces -- a picker that silently does nothing is the
 * failure mode this whole file exists to remove.
 */
export async function pickVideo(): Promise<{ file: File; handle: FileSystemFileHandle | null } | null> {
  const picker = (window as unknown as { showOpenFilePicker?: ShowOpenFilePicker })
    .showOpenFilePicker;
  if (!picker) return null;
  let handles: FileSystemFileHandle[];
  try {
    handles = await picker({
      multiple: false,
      types: [
        {
          description: "Video",
          accept: {
            "video/*": [".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi", ".ogv"],
          },
        },
      ],
    });
  } catch (e) {
    // The spec throws AbortError when the user closes the dialog. That is
    // a choice, not a fault.
    if (e instanceof DOMException && e.name === "AbortError") return null;
    throw e;
  }
  const handle = handles[0];
  if (!handle) return null;
  return { file: await handle.getFile(), handle };
}

/** The handle behind a dropped item, when the browser exposes one. */
export async function handleFromDrop(item: DataTransferItem): Promise<FileSystemFileHandle | null> {
  const get = (item as DataTransferItemWithHandle).getAsFileSystemHandle;
  if (!get) return null;
  try {
    const handle = await get.call(item);
    return handle && handle.kind === "file" ? (handle as FileSystemFileHandle) : null;
  } catch {
    return null;
  }
}

// The permission methods are still not in every lib.dom, and
// `getAsFileSystemHandle` is not in any of them.
type PermissionMode = { mode: "read" | "readwrite" };
interface FileSystemHandleWithPermissions {
  queryPermission?: (opts: PermissionMode) => Promise<PermissionState>;
  requestPermission?: (opts: PermissionMode) => Promise<PermissionState>;
}
interface DataTransferItemWithHandle {
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
}
type ShowOpenFilePicker = (opts: {
  multiple?: boolean;
  types?: { description?: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle[]>;
