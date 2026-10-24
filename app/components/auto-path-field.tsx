import { useRef, useState } from "react";
import fieldImage from "../routes/Biobuzzfield.png";

export type AutoPoint = { x: number; y: number };
export type AutoPath = { points: AutoPoint[]; controls: AutoPoint[] };
export type RobotAuto = {
	id: string;
	name: string;
	alliance: "red" | "blue";
	score: number | null;
	path: AutoPath;
};

const VIEW_SIZE = 1000;
type PointGesture = {
	index: number;
	pointerId: number;
	start: AutoPoint;
	last: AutoPoint;
	moved: boolean;
};

function toSvgPath(path: AutoPath) {
	return path.points.slice(1).reduce((svgPath, point, index) => {
		const start = path.points[index];
		const control = path.controls[index] || { x: (start.x + point.x) / 2, y: (start.y + point.y) / 2 };
		return `${svgPath} Q ${control.x} ${control.y} ${point.x} ${point.y}`;
	}, path.points.length ? `M ${path.points[0].x} ${path.points[0].y}` : "");
}

export function AutoPathField({ path, color = "#ffffff", editable = false, onChange }: {
	path: AutoPath;
	color?: string;
	editable?: boolean;
	onChange?: (path: AutoPath) => void;
}) {
	const [placingPoints, setPlacingPoints] = useState(false);
	const [draggingControl, setDraggingControl] = useState<number | null>(null);
	const pointGesture = useRef<PointGesture | null>(null);

	function pointFromEvent(event: React.PointerEvent<SVGSVGElement>): AutoPoint {
		const svg = event.currentTarget;
		const matrix = svg.getScreenCTM();
		if (!matrix) return { x: 0, y: 0 };
		const pointer = svg.createSVGPoint();
		pointer.x = event.clientX;
		pointer.y = event.clientY;
		const point = pointer.matrixTransform(matrix.inverse());
		return {
			x: Math.max(0, Math.min(VIEW_SIZE, point.x)),
			y: Math.max(0, Math.min(VIEW_SIZE, point.y)),
		};
	}

	function addPoint(event: React.PointerEvent<SVGSVGElement>) {
		if (!editable || !placingPoints || draggingControl !== null || !onChange) return;
		const nextPoint = pointFromEvent(event);
		const previous = path.points.at(-1);
		onChange({
			points: [...path.points, nextPoint],
			controls: previous ? [...path.controls, { x: (previous.x + nextPoint.x) / 2, y: (previous.y + nextPoint.y) / 2 }] : path.controls,
		});
	}

	function moveControl(event: React.PointerEvent<SVGSVGElement>) {
		const point = pointFromEvent(event);
		const gesture = pointGesture.current;
		if (gesture?.pointerId === event.pointerId && onChange) {
			const bounds = event.currentTarget.getBoundingClientRect();
			const threshold = bounds.width > 0 ? VIEW_SIZE * 5 / bounds.width : 12;
			const dx = point.x - gesture.last.x;
			const dy = point.y - gesture.last.y;
			if (Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > threshold) gesture.moved = true;
			const controls = path.controls.map((control, index) =>
				index === gesture.index - 1 || index === gesture.index
					? { x: control.x + dx, y: control.y + dy }
					: control,
			);
			onChange({
				...path,
				points: path.points.map((item, index) => index === gesture.index ? point : item),
				controls,
			});
			gesture.last = point;
			return;
		}
		if (draggingControl !== null && onChange) {
			onChange({ ...path, controls: path.controls.map((control, index) => index === draggingControl ? point : control) });
		}
	}

	function startPointGesture(event: React.PointerEvent<SVGCircleElement>, index: number) {
		if (!editable || !onChange) return;
		event.stopPropagation();
		const point = path.points[index];
		pointGesture.current = { index, pointerId: event.pointerId, start: point, last: point, moved: false };
		event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
	}

	function finishPointer(event: React.PointerEvent<SVGSVGElement>) {
		setDraggingControl(null);
		const gesture = pointGesture.current;
		if (!gesture || gesture.pointerId !== event.pointerId) return;
		if (!gesture.moved && onChange) {
			const points = path.points.filter((_, index) => index !== gesture.index);
			let controls: AutoPoint[];
			if (gesture.index === 0) {
				controls = path.controls.slice(1);
			} else if (gesture.index === path.points.length - 1) {
				controls = path.controls.slice(0, -1);
			} else {
				const previous = path.points[gesture.index - 1];
				const next = path.points[gesture.index + 1];
				controls = [
					...path.controls.slice(0, gesture.index - 1),
					{ x: (previous.x + next.x) / 2, y: (previous.y + next.y) / 2 },
					...path.controls.slice(gesture.index + 1),
				];
			}
			onChange({ points, controls });
		}
		pointGesture.current = null;
	}

	function cancelPointer(event: React.PointerEvent<SVGSVGElement>) {
		setDraggingControl(null);
		if (pointGesture.current?.pointerId === event.pointerId) pointGesture.current = null;
	}

	return (
		<div className={`auto-path-field${editable ? " editable" : ""}`}>
			{editable && <div className="auto-path-tools">
				<button type="button" className={placingPoints ? "active" : ""} onClick={() => setPlacingPoints((placing) => !placing)}>
					{placingPoints ? "Finish placing points" : "＋ Place path points"}
				</button>
				<button type="button" onClick={() => { onChange?.({ points: [], controls: [] }); setPlacingPoints(false); }}>Clear path</button>
				<span>{path.points.length} {path.points.length === 1 ? "point" : "points"} · drag segment handles to curve lines</span>
			</div>}
			<svg
				className="auto-path-svg"
				viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`}
				role="img"
				aria-label="2026–27 FTC field with autonomous robot path"
				onPointerDown={addPoint}
				onPointerMove={moveControl}
				onPointerUp={finishPointer}
				onPointerCancel={cancelPointer}
			>
				<image className="auto-path-artwork" href={fieldImage} x="0" y="0" width={VIEW_SIZE} height={VIEW_SIZE} preserveAspectRatio="none" />
				<path className="auto-path-artwork" d={toSvgPath(path)} fill="none" stroke="#071426" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
				<path className="auto-path-artwork" d={toSvgPath(path)} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
				{path.controls.map((control, index) => <g key={`control-${index}`}>
					{editable && <line className="auto-path-artwork" x1={path.points[index].x} y1={path.points[index].y} x2={control.x} y2={control.y} stroke={color} strokeWidth="3" strokeDasharray="10 10" opacity="0.8" />}
					<circle
						cx={control.x}
						cy={control.y}
						r={editable ? 17 : 0}
						fill={editable ? "#071426" : "transparent"}
						stroke={editable ? color : "none"}
						strokeWidth="8"
						className={editable ? "auto-path-control" : ""}
						onPointerDown={editable ? (event) => {
							event.stopPropagation();
							event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
							setDraggingControl(index);
						} : undefined}
					/>
				</g>)}
				{path.points.map((point, index) => <g key={`point-${index}`}>
					<circle
						cx={point.x}
						cy={point.y}
						r="18"
						fill={index === 0 ? color : "#071426"}
						stroke={color}
						strokeWidth="5"
						className={editable ? "auto-path-waypoint" : "auto-path-artwork"}
						onPointerDown={editable ? (event) => startPointGesture(event, index) : undefined}
					/>
					<text className="auto-path-artwork" x={point.x} y={point.y + 6} textAnchor="middle" fill={index === 0 ? "#071426" : "#fff"} fontSize="17" fontWeight="800">{index + 1}</text>
				</g>)}
			</svg>
			{editable && <p className="auto-path-help">Place the starting point first, then click the field for each next location. Drag a midpoint handle to bend its segment.</p>}
		</div>
	);
}

export function AutoPathComparisonField({ paths }: {
	paths: { key: string; label: string; color: string; path: AutoPath }[];
}) {
	if (!paths.length) return <p className="score-trend-empty">Select autos above to compare their paths on the field.</p>;
	return (
		<div className="auto-path-field">
			<svg className="auto-path-svg" viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`} role="img" aria-label="Selected autonomous paths overlaid on the 2026–27 FTC field">
				<image className="auto-path-artwork" href={fieldImage} x="0" y="0" width={VIEW_SIZE} height={VIEW_SIZE} preserveAspectRatio="none" />
				{paths.map((item) => <g key={item.key}>
					<path className="auto-path-artwork" d={toSvgPath(item.path)} fill="none" stroke="#071426" strokeWidth="15" strokeLinecap="round" strokeLinejoin="round" />
					<path className="auto-path-artwork" d={toSvgPath(item.path)} fill="none" stroke={item.color} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round">
						<title>{item.label}</title>
					</path>
					{item.path.points.map((point, index) => <circle className="auto-path-artwork" key={index} cx={point.x} cy={point.y} r={index === 0 ? 14 : 9} fill={item.color} stroke="#071426" strokeWidth="4">
						<title>{`${item.label} · point ${index + 1}`}</title>
					</circle>)}
				</g>)}
			</svg>
			<div className="auto-path-legend">{paths.map((item) => <span key={item.key}><i style={{ backgroundColor: item.color }} />{item.label}</span>)}</div>
		</div>
	);
}
