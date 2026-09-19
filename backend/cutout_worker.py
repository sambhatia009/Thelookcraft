"""Bounded subprocess entry point; stdout contains only the PNG result."""
import io
import sys


def main():
    from PIL import Image
    from rembg import new_session, remove

    image = Image.open(io.BytesIO(sys.stdin.buffer.read())).convert("RGBA")
    image.thumbnail((1280, 1280))
    session = new_session("u2net", providers=["CPUExecutionProvider"])
    result = remove(image, session=session)
    output = io.BytesIO()
    result.save(output, "PNG")
    sys.stdout.buffer.write(output.getvalue())


if __name__ == "__main__":
    main()