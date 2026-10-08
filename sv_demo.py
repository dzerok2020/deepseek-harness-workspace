import sys
sys.path.insert(0, "")  # noqa
import numpy as np
import supervision as sv
import cv2

print("supervision", sv.__version__)

# synthetic scene: black 640x480 with two colored boxes as "detections"
scene = np.zeros((480, 640, 3), dtype=np.uint8)
scene[:] = (30, 30, 30)
det = sv.Detections(
    xyxy=np.array([[50, 60, 260, 300], [330, 100, 600, 420]], dtype=np.float64),
    confidence=np.array([0.91, 0.77], dtype=float),
    class_id=np.array([0, 2], dtype=int),
    data={"labels": np.array(["person", "car"], dtype=object)},
)
box = sv.BoxAnnotator()
lbl = sv.LabelAnnotator()
labels = [f"{l} {c:.2f}" for l, c in zip(det["labels"], det.confidence)]
annotated = box.annotate(scene.copy(), det)
annotated = lbl.annotate(annotated, det, labels)
out = "/home/dzerok/Documents/deepseek-harness/default-workspace/sv_demo_annotated.png"
assert cv2.imwrite(out, annotated), "imwrite failed"
print("WROTE", out)

# zone counting smoke (LineZone needs tracker_id to count crossings)
det.tracker_id = np.array([1, 2], dtype=int)
line = sv.LineZone(start=sv.Point(0, 240), end=sv.Point(640, 240))
triggered, count = line.trigger(det)
print("LineZone count:", count)

# doc-skill libs import smoke
import pypdf, pdfplumber, pdf2image, reportlab, openpyxl, lxml.etree, defusedxml, PIL, imageio, anthropic, mcp  # noqa: F401
print("ALL_LIBS_OK")

# real PDF round-trip like the pdf skill would: create with reportlab, read with pypdf
from reportlab.pdfgen import canvas as rlc
pdfp = "/home/dzerok/Documents/deepseek-harness/default-workspace/sv_demo.pdf"
c = rlc.Canvas(pdfp)
c.drawString(100, 700, "Firstmate+Skills integration test 42")
c.showPage(); c.save()
r = pypdf.PdfReader(pdfp)
txt = r.pages[0].extract_text()
assert "42" in txt, txt
print("PDF_ROUNDTRIP_OK", len(r.pages), "page(s)")
