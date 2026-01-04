<script lang="ts">
import { onDestroy, onMount } from 'svelte';
import type { SerializedTimeSeriesDataPoint, TimePeriod } from './types';

interface Dataset {
	label: string;
	data: SerializedTimeSeriesDataPoint[];
	borderColor: string;
	backgroundColor?: string;
	fill?: boolean;
	borderDash?: number[];
	tension?: number;
}

interface Props {
	datasets: Dataset[];
	title?: string;
	yAxisLabel?: string;
	height?: number;
	period?: TimePeriod;
	class?: string;
}

let {
	datasets,
	title,
	yAxisLabel,
	height = 300,
	period = '7d',
	class: className = ''
}: Props = $props();

let canvas: HTMLCanvasElement;
let chart: import('chart.js').Chart | null = null;

// Time unit configuration based on period
const timeConfig = $derived(() => {
	switch (period) {
		case '24h':
			return {
				unit: 'hour' as const,
				displayFormats: { hour: 'HH:mm' },
				tooltipFormat: 'MMM d, HH:mm'
			};
		case '7d':
			return {
				unit: 'day' as const,
				displayFormats: { day: 'MMM d' },
				tooltipFormat: 'MMM d, yyyy HH:mm'
			};
		case '30d':
			return {
				unit: 'day' as const,
				displayFormats: { day: 'MMM d' },
				tooltipFormat: 'MMM d, yyyy'
			};
	}
});

// Transform datasets to Chart.js format
const chartData = $derived(() => ({
	datasets: datasets.map((ds) => {
		const dataset: {
			label: string;
			data: { x: number; y: number }[];
			borderColor: string;
			backgroundColor: string;
			fill: boolean;
			tension: number;
			pointRadius: number;
			pointHoverRadius: number;
			borderDash?: number[];
		} = {
			label: ds.label,
			data: ds.data.map((point) => ({
				x: new Date(point.timestamp).getTime(),
				y: point.value
			})),
			borderColor: ds.borderColor,
			backgroundColor: ds.backgroundColor ?? `${ds.borderColor}20`,
			fill: ds.fill ?? false,
			tension: ds.tension ?? 0.3,
			pointRadius: 2,
			pointHoverRadius: 5
		};

		// Only add borderDash if defined
		if (ds.borderDash) {
			dataset.borderDash = ds.borderDash;
		}

		return dataset;
	})
}));

onMount(async () => {
	// Dynamically import Chart.js to avoid SSR issues
	const { Chart, registerables } = await import('chart.js');
	// Import date adapter for side effects (registers itself with Chart.js)
	await import('chartjs-adapter-date-fns');

	Chart.register(...registerables);

	const config = timeConfig();
	chart = new Chart(canvas, {
		type: 'line',
		data: chartData(),
		options: {
			responsive: true,
			maintainAspectRatio: false,
			interaction: {
				mode: 'index',
				intersect: false
			},
			plugins: {
				title: title
					? {
							display: true,
							text: title,
							font: { size: 14, weight: 'normal' }
						}
					: { display: false },
				legend: {
					position: 'bottom',
					labels: {
						usePointStyle: true,
						boxWidth: 8
					}
				},
				tooltip: {
					backgroundColor: 'rgba(0, 0, 0, 0.8)',
					titleColor: '#fff',
					bodyColor: '#fff',
					borderColor: 'rgba(255, 255, 255, 0.1)',
					borderWidth: 1,
					padding: 12,
					displayColors: true
				}
			},
			scales: {
				x: {
					type: 'time',
					time: {
						unit: config.unit,
						displayFormats: config.displayFormats,
						tooltipFormat: config.tooltipFormat
					},
					grid: {
						display: false
					},
					ticks: {
						maxRotation: 0,
						color: 'rgb(156, 163, 175)'
					}
				},
				y: {
					beginAtZero: true,
					title: yAxisLabel
						? {
								display: true,
								text: yAxisLabel,
								color: 'rgb(156, 163, 175)'
							}
						: { display: false },
					grid: {
						color: 'rgba(156, 163, 175, 0.1)'
					},
					ticks: {
						color: 'rgb(156, 163, 175)',
						precision: 0
					}
				}
			}
		}
	});
});

// Update chart when data or period changes
$effect(() => {
	if (chart) {
		const config = timeConfig();
		chart.data = chartData();
		if (chart.options.scales?.x && 'time' in chart.options.scales.x) {
			(
				chart.options.scales.x as {
					time: { unit: string; displayFormats: object; tooltipFormat: string };
				}
			).time = {
				unit: config.unit,
				displayFormats: config.displayFormats,
				tooltipFormat: config.tooltipFormat
			};
		}
		chart.update('none');
	}
});

onDestroy(() => {
	if (chart) {
		chart.destroy();
		chart = null;
	}
});
</script>

<div class="relative {className}" style="height: {height}px">
	<canvas bind:this={canvas}></canvas>
</div>
