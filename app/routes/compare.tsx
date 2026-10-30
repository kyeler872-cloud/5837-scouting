import type { Route } from "./+types/compare";
import { useAuth } from "@clerk/react-router";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Protected } from "../protected";
import { TopNavigation } from "../components/top-navigation";
import { ScoreTrendChart, type ComparisonTeam } from "../components/score-trend-chart";
import { AutoPathComparisonField, type RobotAuto } from "../components/auto-path-field";

type TeamResponse = {
	league: "FTC" | "FRC";
	teamNumber: string;
	season: string;
	performanceByEvent: ComparisonTeam["events"];
	performance: { teleop: { average: string | null; matchCount: number } };
	robots: {
		id: string;
		name: string;
		description: string;
		scoringCapabilities: {
			flower: boolean;
			flowerActions: ("Take from" | "Input into")[];
			hive: boolean;
			hivePosition: "Underhand" | "Overhand" | null;
			hiveShooterType: "Fixed" | "Dynamic" | null;
		};
		autos: RobotAuto[];
	}[];
};
type ComparisonTeamData = ComparisonTeam & {
	robots: TeamResponse["robots"];
	teleop: TeamResponse["performance"]["teleop"];
};
type MatchComparisonTeam = Pick<ComparisonTeamData, "teamNumber" | "robots" | "teleop">;
type MatchComparisonResult = {
	league: "FTC" | "FRC";
	season: string;
	red: MatchComparisonTeam[];
	blue: MatchComparisonTeam[];
	redAverage: number | null;
	blueAverage: number | null;
};

function teamApiUrl(teamNumber: string, season: string, league: "FTC" | "FRC") {
	return `/api/teams/${encodeURIComponent(teamNumber)}?${new URLSearchParams({ season, league: league.toLowerCase() })}`;
}

async function readResponse<T>(response: Response): Promise<T> {
	const body = await response.text();
	try {
		return JSON.parse(body) as T;
	} catch {
		throw new Error(body || `Request failed (${response.status}).`);
	}
}

export function meta({}: Route.MetaArgs) {
	return [{ title: "Compare teams | Scout 5837" }];
}

export default function Compare() {
	const { getToken } = useAuth();
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const teamNumber = searchParams.get("team") || "";
	const leagueParam = searchParams.get("league")?.toUpperCase();
	const league = leagueParam === "FTC" || leagueParam === "FRC" ? leagueParam : null;
	const season = searchParams.get("season") || "";
	const cameFromTeamPage = searchParams.get("from") === "team";
	const [selectedTeam, setSelectedTeam] = useState<ComparisonTeamData | null>(null);
	const [comparisonTeams, setComparisonTeams] = useState<ComparisonTeamData[]>([]);
	const [selectedAutos, setSelectedAutos] = useState<Record<string, string>>({});
	const [comparisonInput, setComparisonInput] = useState("");
	const [startTeamNumber, setStartTeamNumber] = useState("");
	const [startLeague, setStartLeague] = useState<"FTC" | "FRC">("FTC");
	const [startSeason, setStartSeason] = useState("2026");
	const [isLoadingSelected, setIsLoadingSelected] = useState(false);
	const [isComparing, setIsComparing] = useState(false);
	const [matchTeamNumbers, setMatchTeamNumbers] = useState(() => ({
		red: [cameFromTeamPage ? teamNumber : "", ""],
		blue: ["", ""],
	}));
	const [matchComparison, setMatchComparison] = useState<MatchComparisonResult | null>(null);
	const [isLoadingMatchComparison, setIsLoadingMatchComparison] = useState(false);
	const [matchComparisonError, setMatchComparisonError] = useState("");
	const [error, setError] = useState("");

	useEffect(() => {
		let cancelled = false;
		setSelectedTeam(null);
		setComparisonTeams([]);
		setSelectedAutos({});
		setError("");

		if (!teamNumber) {
			setIsLoadingSelected(false);
			return () => { cancelled = true; };
		}
		if (!/^\d{1,6}$/.test(teamNumber) || !league || !/^\d{4}$/.test(season)) {
			setError("The selected team, program, or season in the comparison link is invalid.");
			setIsLoadingSelected(false);
			return () => { cancelled = true; };
		}

		setIsLoadingSelected(true);
		void (async () => {
			try {
				const token = await getToken();
				const response = await fetch(teamApiUrl(teamNumber, season, league), {
					headers: token ? { Authorization: `Bearer ${token}` } : undefined,
				});
				const data = await readResponse<TeamResponse | { error?: string }>(response);
				if (!response.ok) {
					throw new Error("error" in data ? data.error || "Could not load the selected team." : "Could not load the selected team.");
				}
				if (cancelled) return;
				const team = data as TeamResponse;
				setSelectedTeam({ teamNumber: team.teamNumber, events: team.performanceByEvent, robots: team.robots || [], teleop: team.performance.teleop });
			} catch (loadError) {
				if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load the selected team.");
			} finally {
				if (!cancelled) setIsLoadingSelected(false);
			}
		})();

		return () => { cancelled = true; };
	}, [teamNumber, league, season, getToken]);

	function beginComparison(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const number = startTeamNumber.trim();
		if (!/^\d{1,6}$/.test(number)) {
			setError(`Enter a valid ${startLeague} team number.`);
			return;
		}
		navigate(`/compare?${new URLSearchParams({ team: number, league: startLeague, season: startSeason })}`);
	}

	async function addComparisonTeam(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!league || !season || !selectedTeam) return;
		const number = comparisonInput.trim();
		if (!/^\d{1,6}$/.test(number)) {
			setError(`Enter a valid ${league} team number.`);
			return;
		}
		if (number === selectedTeam.teamNumber || comparisonTeams.some((team) => team.teamNumber === number)) {
			setError("That team is already selected.");
			return;
		}
		if (comparisonTeams.length >= 3) {
			setError("Compare up to four teams at a time, including the selected team.");
			return;
		}

		setIsComparing(true);
		setError("");
		try {
			const token = await getToken();
			const response = await fetch(teamApiUrl(number, season, league), {
				headers: token ? { Authorization: `Bearer ${token}` } : undefined,
			});
			const data = await readResponse<TeamResponse | { error?: string }>(response);
			if (!response.ok) {
				throw new Error("error" in data ? data.error || "Could not load comparison team." : "Could not load comparison team.");
			}
			const team = data as TeamResponse;
			setComparisonTeams((current) => [...current, { teamNumber: team.teamNumber, events: team.performanceByEvent, robots: team.robots || [], teleop: team.performance.teleop }]);
			setComparisonInput("");
		} catch (compareError) {
			setError(compareError instanceof Error ? compareError.message : "Could not load comparison team.");
		} finally {
			setIsComparing(false);
		}
	}

	async function compareMatchup(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const redNumbers = matchTeamNumbers.red.map((number) => number.trim());
		const blueNumbers = matchTeamNumbers.blue.map((number) => number.trim());
		const numbers = [...redNumbers, ...blueNumbers];
		if (numbers.some((number) => !/^\d{1,6}$/.test(number))) {
			setMatchComparisonError("Enter a valid team number in all four fields.");
			return;
		}
		if (new Set(numbers).size !== numbers.length) {
			setMatchComparisonError("Each team can only appear once in the matchup.");
			return;
		}

		const comparisonLeague = league || startLeague;
		const comparisonSeason = season || startSeason;
		setIsLoadingMatchComparison(true);
		setMatchComparison(null);
		setMatchComparisonError("");
		try {
			const token = await getToken();
			const teams = await Promise.all(numbers.map(async (number): Promise<MatchComparisonTeam> => {
				const response = await fetch(teamApiUrl(number, comparisonSeason, comparisonLeague), {
					headers: token ? { Authorization: "Bearer " + token } : undefined,
				});
				const data = await readResponse<TeamResponse | { error?: string }>(response);
				if (!response.ok) {
					throw new Error("error" in data ? data.error || `Could not load team ${number}.` : `Could not load team ${number}.`);
				}
				const team = data as TeamResponse;
				return {
					teamNumber: team.teamNumber,
					teleop: team.performance.teleop,
					robots: team.robots || [],
				};
			}));
			const allianceAverage = (alliance: MatchComparisonTeam[]) => {
				const availableScores = alliance
					.map((team) => team.teleop.average === null ? null : Number(team.teleop.average))
					.filter((score): score is number => score !== null && Number.isFinite(score) && score >= 0);
				return availableScores.length
					? availableScores.reduce((total, score) => total + score, 0) / availableScores.length
					: null;
			};
			const red = teams.slice(0, 2);
			const blue = teams.slice(2);
			setMatchComparison({
				league: comparisonLeague,
				season: comparisonSeason,
				red,
				blue,
				redAverage: allianceAverage(red),
				blueAverage: allianceAverage(blue),
			});
		} catch (comparisonError) {
			setMatchComparisonError(comparisonError instanceof Error ? comparisonError.message : "Could not compare these teams.");
		} finally {
			setIsLoadingMatchComparison(false);
		}
	}

	const profileUrl = league && season && teamNumber
		? `/home?${new URLSearchParams({ team: teamNumber, league, season })}`
		: "/home";
	const allTeams = selectedTeam ? [selectedTeam, ...comparisonTeams] : [];
	const autoColors = ["#f4f8ff", "#ffe08a", "#76e2b5", "#ff9caf"];
	const chosenAutos = allTeams.flatMap((team, teamIndex) => {
		const autoId = selectedAutos[team.teamNumber];
		const auto = team.robots.flatMap((robot) => robot.autos).find((item) => item.id === autoId);
		return auto ? [{
			key: `${team.teamNumber}-${auto.id}`,
			label: `${league} ${team.teamNumber} · ${auto.name} (${auto.alliance})`,
			color: autoColors[teamIndex % autoColors.length],
			path: auto.path,
		}] : [];
	});

	function selectAuto(teamNumberToUpdate: string, autoId: string) {
		const selectedAuto = allTeams.find((team) => team.teamNumber === teamNumberToUpdate)?.robots
			.flatMap((robot) => robot.autos).find((auto) => auto.id === autoId);
		if (selectedAuto) {
			const otherAllianceSelections = Object.entries(selectedAutos)
				.filter(([number, id]) => number !== teamNumberToUpdate && id)
				.map(([number, id]) => allTeams.find((team) => team.teamNumber === number)?.robots.flatMap((robot) => robot.autos).find((auto) => auto.id === id))
				.filter((auto) => auto?.alliance === selectedAuto.alliance);
			if (otherAllianceSelections.length >= 2) {
				setError(`Choose no more than two ${selectedAuto.alliance} alliance autos.`);
				return;
			}
		}
		setError("");
		setSelectedAutos((current) => {
			const next = { ...current };
			if (autoId) next[teamNumberToUpdate] = autoId;
			else delete next[teamNumberToUpdate];
			return next;
		});
	}

	return (
		<Protected>
			<main className="home-shell">
				<TopNavigation currentPage="compare" />
				<section className="comparison-page">
					<header className="comparison-page-heading">
						<p className="section-kicker">Season performance</p>
						<h1>Compare teams</h1>
						<p>Compare Auto and TeleOp event averages for teams in the same program and season.</p>
					</header>
					{!teamNumber && <>
						<p className="comparison-page-notice">Choose a team to start a comparison, or open a team’s score graph to bring that team here preselected.</p>
						<form className="comparison-start-form" onSubmit={beginComparison}>
							<label>Program
								<select value={startLeague} onChange={(event) => {
									const nextLeague = event.target.value as "FTC" | "FRC";
									setStartLeague(nextLeague);
									setStartSeason("2026");
								}}>
									<option value="FTC">FTC</option>
									<option value="FRC">FRC</option>
								</select>
							</label>
							<label>Season
								<select value={startSeason} onChange={(event) => setStartSeason(event.target.value)}>
									{(startLeague === "FTC" ? [2026, 2025, 2024, 2023, 2022, 2021, 2020] : Array.from({ length: 35 }, (_, index) => 2026 - index)).map((year) => <option key={year} value={year}>{year}-{String(year + 1).slice(-2)}</option>)}
								</select>
							</label>
							<label>Team number
								<input value={startTeamNumber} onChange={(event) => setStartTeamNumber(event.target.value)} inputMode="numeric" pattern="[0-9]*" maxLength={6} />
							</label>
							<button className="search-button" type="submit">Start comparison</button>
						</form>
					</>}
					{teamNumber && <p className="comparison-page-context">
						Selected team: {league || "Unknown program"} {teamNumber} · {season || "Unknown season"}
						{cameFromTeamPage && <>{" · "}<a href={profileUrl}>Back to robot page</a></>}
					</p>}
					{isLoadingSelected && <p className="comparison-page-notice" role="status">Loading selected team…</p>}
					{error && <p className="lookup-error" role="alert">{error}</p>}
					{selectedTeam && league && season && <>
						<form className="team-compare-form" onSubmit={(event) => void addComparisonTeam(event)}>
							<label>
								<span>Add a team to compare</span>
								<input
									inputMode="numeric"
									pattern="[0-9]*"
									maxLength={6}
									value={comparisonInput}
									onChange={(event) => setComparisonInput(event.target.value)}
									placeholder={`${league} team number`}
									aria-label={`${league} team number to compare`}
								/>
							</label>
							<button className="search-button" type="submit" disabled={isComparing || comparisonTeams.length >= 3}>
								{isComparing ? "Loading team..." : "＋ Add team"}
							</button>
						</form>
						<ul className="team-compare-list" aria-label="Teams in comparison">
							<li>{league} {selectedTeam.teamNumber} <span>Selected team</span></li>
							{comparisonTeams.map((team) => <li key={team.teamNumber}>
								{league} {team.teamNumber}
								<button type="button" onClick={() => {
									setComparisonTeams((current) => current.filter((item) => item.teamNumber !== team.teamNumber));
									setSelectedAutos((current) => {
										const next = { ...current };
										delete next[team.teamNumber];
										return next;
									});
								}} aria-label={`Remove team ${team.teamNumber} from comparison`}>Remove</button>
							</li>)}
						</ul>
						<ScoreTrendChart league={league} teams={[selectedTeam, ...comparisonTeams]} />
						{league === "FTC" && season === "2026" && <section className="auto-compare-section" aria-labelledby="auto-compare-title">
							<header><p className="section-kicker">2026–27 FTC</p><h2 id="auto-compare-title">Compare autonomous paths</h2>
								<p>Select one auto per team. Compare up to four teams, with no more than two autos from either alliance.</p>
							</header>
							<div className="auto-compare-selectors">{allTeams.map((team) => {
								const autos = team.robots.flatMap((robot) => robot.autos.map((auto) => ({ ...auto, robotName: robot.name || "Unnamed robot" })));
								return <label key={team.teamNumber}>
									<span>{league} {team.teamNumber} auto</span>
									<select value={selectedAutos[team.teamNumber] || ""} onChange={(event) => selectAuto(team.teamNumber, event.target.value)}>
										<option value="">Do not include</option>
										{autos.map((auto) => <option key={auto.id} value={auto.id}>{auto.name} · {auto.alliance}{auto.score !== null ? ` · ${auto.score} pts` : ""} · ${auto.robotName}</option>)}
									</select>
									{autos.length === 0 && <small>No saved 2026–27 autos for this team.</small>}
								</label>;
							})}</div>
							<AutoPathComparisonField paths={chosenAutos} />
						</section>}
					</>}
					<section className="match-compare-section" aria-labelledby="match-compare-title">
						<header>
							<p className="section-kicker">{league || startLeague} · {season || startSeason}</p>
							<h2 id="match-compare-title">Match comparison</h2>
							<p>THIS IS VERY INACCURATE AND IN PROGRESS!</p>
						</header>
						<form className="match-compare-form" onSubmit={(event) => void compareMatchup(event)}>
							{(["red", "blue"] as const).map((alliance) => <fieldset className={`match-compare-alliance match-compare-${alliance}`} key={alliance}>
								<legend>{alliance === "red" ? "Red alliance" : "Blue alliance"}</legend>
								{matchTeamNumbers[alliance].map((number, teamIndex) => <label key={`${alliance}-${teamIndex}`}>
									<span>Team {teamIndex + 1}</span>
									<input
										required
										inputMode="numeric"
										pattern="[0-9]*"
										maxLength={6}
										value={number}
										onChange={(changeEvent) => {
											const value = changeEvent.target.value;
											setMatchTeamNumbers((current) => ({
												...current,
												[alliance]: current[alliance].map((currentNumber, index) => index === teamIndex ? value : currentNumber),
											}));
										}}
										aria-label={`${alliance} alliance team ${teamIndex + 1}`}
									/>
								</label>)}
							</fieldset>)}
							<button className="search-button" type="submit" disabled={isLoadingMatchComparison}>
								{isLoadingMatchComparison ? "Loading teams..." : "Compare match"}
							</button>
						</form>
						{matchComparisonError && <p className="lookup-error" role="alert">{matchComparisonError}</p>}
						{matchComparison && <div className="match-compare-results" aria-live="polite">
							<p className="match-compare-season">{matchComparison.league} · {matchComparison.season}</p>
							<div className="match-compare-score-grid">
								{([
									{ name: "Red", teams: matchComparison.red, average: matchComparison.redAverage },
									{ name: "Blue", teams: matchComparison.blue, average: matchComparison.blueAverage },
								]).map((alliance) => <article className={`match-compare-card match-compare-${alliance.name.toLowerCase()}`} key={alliance.name}>
									<h3>{alliance.name} alliance</h3>
									<p className="match-compare-score">
										{alliance.average === null ? "No TeleOp data" : `${alliance.average.toFixed(1)} avg TeleOp pts`}
									</p>
									{alliance.teams.map((team) => <div className="match-compare-team" key={team.teamNumber}>
										<h4>{matchComparison.league} {team.teamNumber}</h4>
										<p>{team.teleop.average === null
											? "No average TeleOp score available"
											: `Avg TeleOp: ${team.teleop.average} pts across ${team.teleop.matchCount} matches`}</p>
										<div className="match-compare-strategies">
											<strong>Registered game strategy</strong>
											{team.robots.length ? team.robots.map((robot) => {
												const capabilities = robot.scoringCapabilities;
												const strategyItems = [
													...(capabilities.flower ? [`Flower${capabilities.flowerActions.length ? ` · ${capabilities.flowerActions.join(" / ")}` : ""}`] : []),
													...(capabilities.hive ? [`Hive${capabilities.hivePosition ? ` · ${capabilities.hivePosition}` : ""}${capabilities.hiveShooterType ? ` · ${capabilities.hiveShooterType}` : ""}`] : []),
												];
												return <div key={robot.id}>
													{robot.name && <span>{robot.name}</span>}
													{robot.description && <p>{robot.description}</p>}
													{strategyItems.length > 0 && <p>{strategyItems.join(" · ")}</p>}
												</div>;
											}) : <p>No robot strategy has been added to this team profile.</p>}
										</div>
									</div>)}
								</article>)}
							</div>
							{matchComparison.redAverage === null || matchComparison.blueAverage === null
								? <p className="match-compare-verdict">A projected winner needs TeleOp data for at least one team on each alliance.</p>
								: matchComparison.redAverage === matchComparison.blueAverage
									? <p className="match-compare-verdict">Projected tie: both alliances average {matchComparison.redAverage.toFixed(1)} TeleOp points.</p>
									: <p className="match-compare-verdict">
										{matchComparison.redAverage > matchComparison.blueAverage ? "Red" : "Blue"} alliance is favored based on its higher projected TeleOp average.
									</p>}
							<p className="match-compare-caveat">This is a historical TeleOp estimate, not a guaranteed result. Robot strategies are shown for context and do not add an assumed point bonus.</p>
						</div>}
					</section>
				</section>
			</main>
		</Protected>
	);
}
