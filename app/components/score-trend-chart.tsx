export type EventPerformance = {
	eventCode: string;
	eventName: string;
	eventDate: string | null;
	auto: string | null;
	teleop: string | null;
};

export type ComparisonTeam = { teamNumber: string; events: EventPerformance[] };

export function ScoreTrendChart({ teams, league }: { teams: ComparisonTeam[]; league: "FTC" | "FRC" }) {
	const eventMap = new Map<string, { eventCode: string; eventName: string; eventDate: string | null }>();
	for (const team of teams) {
		for (const event of team.events) {
			if (!eventMap.has(event.eventCode)) {
				eventMap.set(event.eventCode, {
					eventCode: event.eventCode,
					eventName: event.eventName,
					eventDate: event.eventDate,
				});
			}
		}
	}
	const events = [...eventMap.values()].sort((first, second) =>
		(first.eventDate || "").localeCompare(second.eventDate || "") || first.eventName.localeCompare(second.eventName),
	);
	const width = Math.max(700, events.length * 130 + 100);
	const height = 340;
	const left = 58;
	const right = width - 28;
	const top = 24;
	const bottom = 242;
	const colors = ["#6dd7ff", "#a78bfa", "#ffbe6f", "#64dfb4"];
	const series = teams.flatMap((team, teamIndex) => ([
		{ teamNumber: team.teamNumber, phase: "auto" as const, label: `${league} ${team.teamNumber} · Auto`, color: colors[teamIndex % colors.length], dashed: false, events: team.events },
		{ teamNumber: team.teamNumber, phase: "teleop" as const, label: `${league} ${team.teamNumber} · TeleOp`, color: colors[teamIndex % colors.length], dashed: true, events: team.events },
	]));
	const scores = series.flatMap((item) => item.events.map((event) => event[item.phase]))
		.map((score) => score === null ? null : Number(score))
		.filter((score): score is number => score !== null && Number.isFinite(score));
	if (!scores.length) {
		return <p className="score-trend-empty">No event-level scored matches are available for this season.</p>;
	}
	const maxScore = Math.max(10, Math.ceil(Math.max(...scores) / 10) * 10);
	const x = (index: number) => events.length === 1
		? (left + right) / 2
		: left + (index / (events.length - 1)) * (right - left);
	const y = (score: number) => bottom - (score / maxScore) * (bottom - top);

	return (
		<div className="score-trend-card">
			<div className="score-trend-legend" aria-hidden="true">
				{series.map((item) => <span key={`${item.teamNumber}-${item.phase}`}>
					<i className={item.dashed ? "dashed" : ""} style={{ color: item.color, backgroundColor: item.dashed ? "transparent" : item.color }} />
					{item.label}
				</span>)}
			</div>
			<div className="score-trend-scroll">
				<svg className="score-trend-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Combined team Auto and TeleOp average alliance scores by event">
					<title>Combined team Auto and TeleOp scores by event</title>
					{[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
						const score = maxScore * fraction;
						const tickY = y(score);
						return <g key={fraction}>
							<line x1={left} y1={tickY} x2={right} y2={tickY} className="score-trend-gridline" />
							<text x={left - 10} y={tickY + 4} textAnchor="end" className="score-trend-tick">{score.toFixed(0)}</text>
						</g>;
					})}
					<line x1={left} y1={bottom} x2={right} y2={bottom} className="score-trend-axis" />
					{series.map((item) => {
						const eventScores = new Map(item.events.map((event) => [event.eventCode, event[item.phase]]));
						const points = events.map((event, index) => {
							const rawScore = eventScores.get(event.eventCode);
							const score = rawScore === null || rawScore === undefined ? null : Number(rawScore);
							return score !== null && Number.isFinite(score) ? { x: x(index), y: y(score), score, event } : null;
						});
						let drawing = false;
						const path = points.map((point) => {
							if (!point) {
								drawing = false;
								return "";
							}
							const command = drawing ? "L" : "M";
							drawing = true;
							return `${command} ${point.x} ${point.y}`;
						}).filter(Boolean).join(" ");
						return <g key={`${item.teamNumber}-${item.phase}`}>
							<path d={path} fill="none" stroke={item.color} strokeWidth="3" strokeDasharray={item.dashed ? "7 5" : undefined} strokeLinecap="round" strokeLinejoin="round" />
							{points.map((point) => point && <circle key={point.event.eventCode} cx={point.x} cy={point.y} r="5" fill={item.color} className="score-trend-point">
								<title>{`${point.event.eventName}: ${item.label} ${point.score.toFixed(1)} points per match`}</title>
							</circle>)}
						</g>;
					})}
					{events.map((event, index) => <g key={event.eventCode}>
						<line x1={x(index)} y1={bottom} x2={x(index)} y2={bottom + 5} className="score-trend-axis" />
						<text x={x(index)} y={bottom + 24} textAnchor="middle" className="score-trend-event-label">
							<title>{event.eventName}{event.eventDate ? ` · ${event.eventDate}` : ""}</title>
							{event.eventName.length > 17 ? `${event.eventName.slice(0, 16)}…` : event.eventName}
						</text>
					</g>)}
					<text x="15" y={(top + bottom) / 2} textAnchor="middle" className="score-trend-axis-label" transform={`rotate(-90 15 ${(top + bottom) / 2})`}>Average points per match</text>
				</svg>
			</div>
			<p className="score-trend-caption">Each point is the team’s alliance average across its scored matches at that event.</p>
		</div>
	);
}
