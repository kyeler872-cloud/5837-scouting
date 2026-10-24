import { useState } from "react";
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

	function pointFromEvent(event: React.PointerEvent<SVGSVGElement>): AutoPoint {
		const bounds = event.currentTarget.getBoundingClientRect();
		return {
			x: Math.max(0, Math.min(VIEW_SIZE, ((event.clientX - bounds.left) / bounds.width) * VIEW_SIZE)),
			y: Math.max(0, Math.min(VIEW_SIZE, ((event.clientY - bounds.top) / bounds.height) * VIEW_SIZE)),
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
		if (draggingControl === null || !onChange) return;
		const point = pointFromEvent(event);
		onChange({ ...path, controls: path.controls.map((control, index) => index === draggingControl ? point : control) });
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
				onPointerUp={() => setDraggingControl(null)}
				onPointerCancel={() => setDraggingControl(null)}
			>
				<image href={fieldImage} x="0" y="0" width={VIEW_SIZE} height={VIEW_SIZE} preserveAspectRatio="none" />
				<path d={toSvgPath(path)} fill="none" stroke="#071426" strokeWidth="22" strokeLinecap="round" strokeLinejoin="round" />
				<path d={toSvgPath(path)} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
				{path.controls.map((control, index) => <g key={`control-${index}`}>
					{editable && <line x1={path.points[index].x} y1={path.points[index].y} x2={control.x} y2={control.y} stroke={color} strokeWidth="4" strokeDasharray="10 10" opacity="0.8" />}
					<circle
						cx={control.x}
						cy={control.y}
						r={editable ? 24 : 0}
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
					<circle cx={point.x} cy={point.y} r="24" fill={index === 0 ? color : "#071426"} stroke={color} strokeWidth="8" />
					<text x={point.x} y={point.y + 7} textAnchor="middle" fill={index === 0 ? "#071426" : "#fff"} fontSize="22" fontWeight="800">{index + 1}</text>
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
				<image href={fieldImage} x="0" y="0" width={VIEW_SIZE} height={VIEW_SIZE} preserveAspectRatio="none" />
				{paths.map((item) => <g key={item.key}>
					<path d={toSvgPath(item.path)} fill="none" stroke="#071426" strokeWidth="25" strokeLinecap="round" strokeLinejoin="round" />
					<path d={toSvgPath(item.path)} fill="none" stroke={item.color} strokeWidth="13" strokeLinecap="round" strokeLinejoin="round">
						<title>{item.label}</title>
					</path>
					{item.path.points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={index === 0 ? 18 : 12} fill={item.color} stroke="#071426" strokeWidth="5">
						<title>{`${item.label} · point ${index + 1}`}</title>
					</circle>)}
				</g>)}
			</svg>
			<div className="auto-path-legend">{paths.map((item) => <span key={item.key}><i style={{ backgroundColor: item.color }} />{item.label}</span>)}</div>
		</div>
	);
}
