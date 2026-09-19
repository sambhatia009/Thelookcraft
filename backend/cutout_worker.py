"""Background-removal worker.

Run with no arguments: one-shot (stdin photo -> stdout PNG).
Run with `--serve`: long-lived; the model stays warm and each request is a 4-byte
big-endian length followed by the photo bytes. Each reply is a 4-byte length followed by
the PNG (length 0 means the cutout failed for that photo).
"""
import io
import struct
import sys


def cutout(session, raw):
    from PIL import Image
    from rembg import remove

    image = Image.open(io.BytesIO(raw)).convert("RGBA")
    image.thumbnail((1280, 1280))
    result = remove(image, session=session)
    output = io.BytesIO()
    result.save(output, "PNG")
    return output.getvalue()


def read_exact(stream, size):
    data = b""
    while len(data) < size:
        chunk = stream.read(size - len(data))
        if not chunk:
            return None
        data += chunk
    return data


def main():
    from rembg import new_session

    session = new_session("u2net", providers=["CPUExecutionProvider"])
    out = sys.stdout.buffer
    if "--serve" not in sys.argv:
        out.write(cutout(session, sys.stdin.buffer.read()))
        return
    # Signal readiness so the parent can pre-warm before the first photo arrives.
    out.write(struct.pack(">I", 0))
    out.flush()
    while True:
        header = read_exact(sys.stdin.buffer, 4)
        if header is None:
            return
        raw = read_exact(sys.stdin.buffer, struct.unpack(">I", header)[0])
        if raw is None:
            return
        try:
            png = cutout(session, raw)
        except Exception as exc:  # keep serving; report failure for this photo only
            sys.stderr.write(f"cutout failed: {type(exc).__name__}: {exc}\n")
            png = b""
        out.write(struct.pack(">I", len(png)) + png)
        out.flush()


if __name__ == "__main__":
    main()
