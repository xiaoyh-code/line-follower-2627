"""Render the three classroom PID plates with Manim Community Edition.

Run `python scripts/render_pid_diagrams.py` in a ManimCE environment.
Only the final images are served by the site.
"""

from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
from manim import (
    Axes, DashedLine, Dot, DOWN, LEFT, Line, Polygon, RIGHT,
    Scene, Text, UP, tempconfig,
)


OUTPUT = Path(__file__).resolve().parents[1] / "public" / "worksheets"
BOARD = "#101C32"
PAPER = "#F5F7FF"
GRID = "#405574"
BLUE = "#94C0FF"
RED = "#FFA0A9"


def label(value, size=30, shade=PAPER, italic=False):
    return Text(
        value, font="STIX Two Text", font_size=size, color=shade,
        slant="ITALIC" if italic else "NORMAL", disable_ligatures=True,
    )


class ErrorSamples(Scene):
    """Shared axes for two consecutive 10 ms samples, with errors +2 and +4."""

    def draw_axes(self):
        axes = Axes(
            x_range=(0, 23, 10), y_range=(0, 5.2, 2),
            x_length=5.6, y_length=2.85,
            axis_config={"color": PAPER, "stroke_width": 3,
                         "include_ticks": False, "include_tip": False},
        ).shift(.06 * LEFT + .18 * UP)
        point = axes.c2p
        for t in (5, 10, 15, 20):
            self.add(Line(point(t, 0), point(t, 5), color=GRID, stroke_width=2))
        for e in (1, 2, 3, 4, 5):
            self.add(Line(point(0, e), point(22.5, e), color=GRID, stroke_width=2))
        self.add(axes)
        for t in (0, 10, 20):
            self.add(label(str(t)).next_to(point(t, 0), DOWN, buff=.10))
        for e in (2, 4):
            self.add(label(str(e)).next_to(point(0, e), LEFT, buff=.12))
        self.add(label("e", 37, italic=True).next_to(point(0, 5.2), LEFT, buff=.13))
        self.add(label("t (ms)", 29).next_to(point(22.5, 0), DOWN, buff=.43)
                 .align_to(point(23, 0), RIGHT))
        return point

    def previous_sample(self, point):
        return Dot(point(10, 2), radius=.075, fill_color=BOARD,
                   stroke_color=PAPER, stroke_width=4)

    def current_sample(self, point):
        return Dot(point(20, 4), radius=.095, color=PAPER)


class Proportional(ErrorSamples):
    def construct(self):
        p = self.draw_axes()
        self.add(DashedLine(p(0, 4), p(20, 4), color=BLUE, stroke_width=3))
        self.add(Line(p(20, 0), p(20, 4), color=BLUE, stroke_width=9))
        self.add(self.previous_sample(p), self.current_sample(p))


class Integral(ErrorSamples):
    def construct(self):
        p = self.draw_axes()
        self.add(Polygon(p(10, 0), p(20, 0), p(20, 4), p(10, 4),
                         color=BLUE, fill_opacity=.33, stroke_width=5))
        # The classroom code uses the current error throughout this interval.
        for start in np.arange(-4, 10, 2):
            left = max(0, start)
            right = min(10, start + 4)
            if right > left:
                self.add(Line(p(10 + left, left - start), p(10 + right, right - start),
                              color=BLUE, stroke_width=2))
        self.add(self.previous_sample(p), self.current_sample(p))


class Derivative(ErrorSamples):
    def construct(self):
        p = self.draw_axes()
        self.add(DashedLine(p(10, 2), p(20, 2), color=BLUE, stroke_width=4))
        self.add(DashedLine(p(20, 2), p(20, 4), color=BLUE, stroke_width=4))
        self.add(Line(p(10, 2), p(20, 4), color=RED, stroke_width=8))
        self.add(label("+2", 27, BLUE).next_to(p(20, 3), RIGHT, buff=.09))
        self.add(self.previous_sample(p), self.current_sample(p))


if __name__ == "__main__":
    with TemporaryDirectory() as cache, tempconfig({
        "media_dir": cache, "background_color": BOARD, "write_to_movie": False,
        "pixel_width": 960, "pixel_height": 570, "frame_width": 7.2,
        "frame_height": 4.275, "verbosity": "WARNING",
    }):
        for plate in (Proportional, Integral, Derivative):
            scene = plate()
            scene.render()
            scene.renderer.update_frame(scene)
            scene.camera.get_image().convert("RGB").save(
                OUTPUT / f"pid-{plate.__name__.lower()}.webp",
                lossless=True, method=6,
            )
