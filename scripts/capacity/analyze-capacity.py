#!/usr/bin/env python3
"""
Capacity Analysis Script - JBCalling Translation System
Phân tích metrics từ Prometheus để đánh giá capacity và tính chi phí scale GCP.

Usage:
    python3 analyze-capacity.py --data-dir ./capacity-data
    python3 analyze-capacity.py --data-dir ./capacity-data --target-users 500
"""

import json
import os
import argparse
from datetime import datetime
from typing import Dict, List, Tuple, Optional
import math

# ===========================================
# GCP Pricing (asia-southeast1 region - Singapore)
# Updated: December 2025
# ===========================================
GCP_PRICING = {
    # Compute Engine - On-demand pricing (per hour)
    "compute": {
        "e2-standard-2": {"vcpu": 2, "memory_gb": 8, "price_hour": 0.0670},
        "e2-standard-4": {"vcpu": 4, "memory_gb": 16, "price_hour": 0.1340},
        "e2-standard-8": {"vcpu": 8, "memory_gb": 32, "price_hour": 0.2680},
        "e2-standard-16": {"vcpu": 16, "memory_gb": 64, "price_hour": 0.5360},
        "n2-standard-2": {"vcpu": 2, "memory_gb": 8, "price_hour": 0.0971},
        "n2-standard-4": {"vcpu": 4, "memory_gb": 16, "price_hour": 0.1942},
        "n2-standard-8": {"vcpu": 8, "memory_gb": 32, "price_hour": 0.3884},
        "n2-standard-16": {"vcpu": 16, "memory_gb": 64, "price_hour": 0.7768},
        "c2-standard-4": {"vcpu": 4, "memory_gb": 16, "price_hour": 0.2088},
        "c2-standard-8": {"vcpu": 8, "memory_gb": 32, "price_hour": 0.4176},
        "c2-standard-16": {"vcpu": 16, "memory_gb": 64, "price_hour": 0.8352},
    },
    # Committed Use Discount (1 year)
    "cud_1yr_discount": 0.37,  # 37% discount
    # Committed Use Discount (3 year)
    "cud_3yr_discount": 0.57,  # 57% discount
    # Storage (per GB per month)
    "storage": {
        "pd-ssd": 0.170,
        "pd-standard": 0.040,
    },
    # Network egress (per GB)
    "network": {
        "egress_apac": 0.12,
        "egress_worldwide": 0.12,
    },
}

# ===========================================
# Resource per User Estimates
# Based on video call with real-time translation
# ===========================================
RESOURCE_PER_USER = {
    "cpu_cores": 0.15,       # ~0.15 CPU cores per concurrent user
    "memory_gb": 0.2,        # ~200MB per concurrent user
    "network_mbps": 2.0,     # ~2 Mbps per user (video + audio)
    "stt_requests_per_min": 4,    # ~4 STT requests per minute per user
    "translation_requests_per_min": 4,  # ~4 translation requests per minute
    "tts_requests_per_min": 2,    # ~2 TTS requests per minute per user
}


def load_json_file(filepath: str) -> Optional[dict]:
    """Load JSON file and return data."""
    try:
        with open(filepath, 'r') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"Warning: Could not load {filepath}: {e}")
        return None


def extract_metric_values(data: dict) -> List[Tuple[float, float]]:
    """Extract timestamp-value pairs from Prometheus response."""
    if not data or data.get('status') != 'success':
        return []
    
    results = data.get('data', {}).get('result', [])
    all_values = []
    
    for result in results:
        values = result.get('values', [])
        for ts, val in values:
            try:
                all_values.append((float(ts), float(val)))
            except (ValueError, TypeError):
                continue
    
    return all_values


def extract_metric_by_label(data: dict, label_key: str = 'instance') -> Dict[str, List[Tuple[float, float]]]:
    """Extract metrics grouped by label."""
    if not data or data.get('status') != 'success':
        return {}
    
    results = data.get('data', {}).get('result', [])
    grouped = {}
    
    for result in results:
        label_value = result.get('metric', {}).get(label_key, 'unknown')
        values = result.get('values', [])
        
        if label_value not in grouped:
            grouped[label_value] = []
        
        for ts, val in values:
            try:
                grouped[label_value].append((float(ts), float(val)))
            except (ValueError, TypeError):
                continue
    
    return grouped


def calculate_stats(values: List[Tuple[float, float]]) -> Dict[str, float]:
    """Calculate statistics from time series values."""
    if not values:
        return {"min": 0, "max": 0, "avg": 0, "p50": 0, "p95": 0, "p99": 0, "count": 0}
    
    nums = [v[1] for v in values if not math.isnan(v[1]) and not math.isinf(v[1])]
    if not nums:
        return {"min": 0, "max": 0, "avg": 0, "p50": 0, "p95": 0, "p99": 0, "count": 0}
    
    nums_sorted = sorted(nums)
    n = len(nums_sorted)
    
    return {
        "min": min(nums),
        "max": max(nums),
        "avg": sum(nums) / n,
        "p50": nums_sorted[int(n * 0.50)],
        "p95": nums_sorted[min(int(n * 0.95), n - 1)],
        "p99": nums_sorted[min(int(n * 0.99), n - 1)],
        "count": n,
    }


def format_bytes(bytes_val: float) -> str:
    """Format bytes to human readable."""
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if abs(bytes_val) < 1024.0:
            return f"{bytes_val:.2f} {unit}"
        bytes_val /= 1024.0
    return f"{bytes_val:.2f} PB"


def format_percentage(val: float) -> str:
    """Format as percentage."""
    return f"{val:.2f}%"


def analyze_capacity(data_dir: str, target_users: int = 500) -> dict:
    """
    Main analysis function.
    
    Args:
        data_dir: Directory containing collected Prometheus data
        target_users: Target number of concurrent users
        
    Returns:
        Analysis results dictionary
    """
    print(f"\n{'='*60}")
    print("📊 CAPACITY ANALYSIS - JBCalling Translation System")
    print(f"{'='*60}")
    print(f"Data directory: {data_dir}")
    print(f"Target users: {target_users}")
    
    results = {
        "analysis_time": datetime.now().isoformat(),
        "data_directory": data_dir,
        "target_users": target_users,
        "current_infrastructure": {},
        "resource_usage": {},
        "service_performance": {},
        "capacity_estimation": {},
        "scale_requirements": {},
        "cost_analysis": {},
        "recommendations": [],
    }
    
    # Load metadata
    metadata = load_json_file(os.path.join(data_dir, "metadata.json"))
    if metadata:
        results["data_period"] = {
            "start": metadata.get("start_time_human"),
            "end": metadata.get("end_time_human"),
            "duration": metadata.get("time_range"),
        }
    
    # ===========================================
    # 1. CURRENT INFRASTRUCTURE ANALYSIS
    # ===========================================
    print(f"\n{'='*60}")
    print("1️⃣ CURRENT INFRASTRUCTURE")
    print(f"{'='*60}")
    
    # CPU count per node
    cpu_count_data = load_json_file(os.path.join(data_dir, "node-cpu-count.json"))
    cpu_counts = {}
    if cpu_count_data and cpu_count_data.get('status') == 'success':
        for result in cpu_count_data.get('data', {}).get('result', []):
            instance = result.get('metric', {}).get('instance', 'unknown')
            value = result.get('value', [0, 0])
            cpu_counts[instance] = int(float(value[1])) if len(value) > 1 else 0
    
    # Memory total per node
    memory_total_data = load_json_file(os.path.join(data_dir, "node-memory-total.json"))
    memory_totals = {}
    if memory_total_data and memory_total_data.get('status') == 'success':
        for result in memory_total_data.get('data', {}).get('result', []):
            instance = result.get('metric', {}).get('instance', 'unknown')
            value = result.get('value', [0, 0])
            memory_totals[instance] = float(value[1]) if len(value) > 1 else 0
    
    nodes = list(set(list(cpu_counts.keys()) + list(memory_totals.keys())))
    total_vcpu = sum(cpu_counts.values())
    total_memory_gb = sum(memory_totals.values()) / (1024**3)
    
    results["current_infrastructure"] = {
        "node_count": len(nodes),
        "nodes": nodes,
        "total_vcpu": total_vcpu,
        "total_memory_gb": round(total_memory_gb, 2),
        "per_node": {
            node: {
                "vcpu": cpu_counts.get(node, 0),
                "memory_gb": round(memory_totals.get(node, 0) / (1024**3), 2)
            }
            for node in nodes
        }
    }
    
    print(f"\nNodes: {len(nodes)}")
    for node in nodes:
        cpu = cpu_counts.get(node, 0)
        mem_gb = memory_totals.get(node, 0) / (1024**3)
        print(f"  • {node}: {cpu} vCPU, {mem_gb:.1f} GB RAM")
    print(f"\nTotal: {total_vcpu} vCPU, {total_memory_gb:.1f} GB RAM")
    
    # ===========================================
    # 2. RESOURCE USAGE ANALYSIS
    # ===========================================
    print(f"\n{'='*60}")
    print("2️⃣ RESOURCE USAGE (24h)")
    print(f"{'='*60}")
    
    # CPU Usage
    cpu_usage_data = load_json_file(os.path.join(data_dir, "node-cpu-usage.json"))
    cpu_by_node = extract_metric_by_label(cpu_usage_data, 'instance')
    
    print("\n📈 CPU Usage:")
    cpu_stats = {}
    for node, values in cpu_by_node.items():
        stats = calculate_stats(values)
        cpu_stats[node] = stats
        print(f"  • {node}: Avg={stats['avg']:.1f}%, Peak={stats['max']:.1f}%, P95={stats['p95']:.1f}%")
    
    # Memory Usage
    memory_usage_data = load_json_file(os.path.join(data_dir, "node-memory-usage.json"))
    memory_by_node = extract_metric_by_label(memory_usage_data, 'instance')
    
    print("\n💾 Memory Usage:")
    memory_stats = {}
    for node, values in memory_by_node.items():
        stats = calculate_stats(values)
        memory_stats[node] = stats
        print(f"  • {node}: Avg={stats['avg']:.1f}%, Peak={stats['max']:.1f}%, P95={stats['p95']:.1f}%")
    
    # Disk Usage
    disk_usage_data = load_json_file(os.path.join(data_dir, "node-disk-usage.json"))
    disk_by_node = extract_metric_by_label(disk_usage_data, 'instance')
    
    print("\n💿 Disk Usage:")
    disk_stats = {}
    for node, values in disk_by_node.items():
        stats = calculate_stats(values)
        disk_stats[node] = stats
        print(f"  • {node}: Avg={stats['avg']:.1f}%, Peak={stats['max']:.1f}%")
    
    # Network
    network_rx_data = load_json_file(os.path.join(data_dir, "node-network-rx.json"))
    network_tx_data = load_json_file(os.path.join(data_dir, "node-network-tx.json"))
    
    network_rx_by_node = extract_metric_by_label(network_rx_data, 'instance')
    network_tx_by_node = extract_metric_by_label(network_tx_data, 'instance')
    
    print("\n🌐 Network Usage:")
    network_stats = {}
    for node in nodes:
        rx_stats = calculate_stats(network_rx_by_node.get(node, []))
        tx_stats = calculate_stats(network_tx_by_node.get(node, []))
        network_stats[node] = {"rx": rx_stats, "tx": tx_stats}
        print(f"  • {node}: RX Avg={format_bytes(rx_stats['avg'])}/s, TX Avg={format_bytes(tx_stats['avg'])}/s")
    
    results["resource_usage"] = {
        "cpu": cpu_stats,
        "memory": memory_stats,
        "disk": disk_stats,
        "network": network_stats,
    }
    
    # ===========================================
    # 3. SERVICE PERFORMANCE ANALYSIS
    # ===========================================
    print(f"\n{'='*60}")
    print("3️⃣ SERVICE PERFORMANCE")
    print(f"{'='*60}")
    
    # STT Performance
    stt_p95_data = load_json_file(os.path.join(data_dir, "stt-p95-latency.json"))
    stt_rate_data = load_json_file(os.path.join(data_dir, "stt-request-rate.json"))
    
    stt_latency_values = extract_metric_values(stt_p95_data)
    stt_rate_values = extract_metric_values(stt_rate_data)
    
    stt_latency_stats = calculate_stats(stt_latency_values)
    stt_rate_stats = calculate_stats(stt_rate_values)
    
    print("\n🎤 STT Service:")
    print(f"  • P95 Latency: Avg={stt_latency_stats['avg']:.2f}s, Peak={stt_latency_stats['max']:.2f}s")
    print(f"  • Request Rate: Avg={stt_rate_stats['avg']:.2f}/s, Peak={stt_rate_stats['max']:.2f}/s")
    
    # Translation Performance
    trans_p95_data = load_json_file(os.path.join(data_dir, "translation-p95-latency.json"))
    trans_rate_data = load_json_file(os.path.join(data_dir, "translation-request-rate.json"))
    
    trans_latency_values = extract_metric_values(trans_p95_data)
    trans_rate_values = extract_metric_values(trans_rate_data)
    
    trans_latency_stats = calculate_stats(trans_latency_values)
    trans_rate_stats = calculate_stats(trans_rate_values)
    
    print("\n🌐 Translation Service:")
    print(f"  • P95 Latency: Avg={trans_latency_stats['avg']:.2f}s, Peak={trans_latency_stats['max']:.2f}s")
    print(f"  • Request Rate: Avg={trans_rate_stats['avg']:.2f}/s, Peak={trans_rate_stats['max']:.2f}/s")
    
    # TTS Performance
    tts_response_data = load_json_file(os.path.join(data_dir, "tts-response-time.json"))
    tts_response_values = extract_metric_values(tts_response_data)
    tts_response_stats = calculate_stats(tts_response_values)
    
    print("\n🔊 TTS Service:")
    print(f"  • Response Time: Avg={tts_response_stats['avg']:.2f}s, Peak={tts_response_stats['max']:.2f}s")
    
    # Gateway Performance
    gateway_rooms_data = load_json_file(os.path.join(data_dir, "gateway-rooms.json"))
    gateway_rooms_values = extract_metric_values(gateway_rooms_data)
    gateway_rooms_stats = calculate_stats(gateway_rooms_values)
    
    print("\n📹 Gateway Service:")
    print(f"  • Active Rooms: Avg={gateway_rooms_stats['avg']:.0f}, Peak={gateway_rooms_stats['max']:.0f}")
    
    results["service_performance"] = {
        "stt": {
            "p95_latency_seconds": stt_latency_stats,
            "request_rate": stt_rate_stats,
        },
        "translation": {
            "p95_latency_seconds": trans_latency_stats,
            "request_rate": trans_rate_stats,
        },
        "tts": {
            "response_time_seconds": tts_response_stats,
        },
        "gateway": {
            "active_rooms": gateway_rooms_stats,
        },
    }
    
    # ===========================================
    # 4. CAPACITY ESTIMATION
    # ===========================================
    print(f"\n{'='*60}")
    print("4️⃣ CAPACITY ESTIMATION")
    print(f"{'='*60}")
    
    # Calculate available resources (using 80% threshold)
    safety_margin = 0.80  # 80% max utilization
    
    avg_cpu_usage = sum(s['avg'] for s in cpu_stats.values()) / len(cpu_stats) if cpu_stats else 0
    avg_memory_usage = sum(s['avg'] for s in memory_stats.values()) / len(memory_stats) if memory_stats else 0
    
    available_cpu_pct = max(0, safety_margin * 100 - avg_cpu_usage)
    available_memory_pct = max(0, safety_margin * 100 - avg_memory_usage)
    
    available_cpu_cores = total_vcpu * (available_cpu_pct / 100)
    available_memory_gb = total_memory_gb * (available_memory_pct / 100)
    
    # Estimate current user capacity
    cpu_based_capacity = available_cpu_cores / RESOURCE_PER_USER["cpu_cores"]
    memory_based_capacity = available_memory_gb / RESOURCE_PER_USER["memory_gb"]
    
    current_capacity = min(cpu_based_capacity, memory_based_capacity)
    bottleneck = "CPU" if cpu_based_capacity < memory_based_capacity else "Memory"
    
    print(f"\n📊 Current Resource Headroom (80% threshold):")
    print(f"  • CPU: {available_cpu_pct:.1f}% available ({available_cpu_cores:.1f} cores)")
    print(f"  • Memory: {available_memory_pct:.1f}% available ({available_memory_gb:.1f} GB)")
    
    print(f"\n👥 Estimated User Capacity:")
    print(f"  • Based on CPU: ~{int(cpu_based_capacity)} concurrent users")
    print(f"  • Based on Memory: ~{int(memory_based_capacity)} concurrent users")
    print(f"  • Current Bottleneck: {bottleneck}")
    print(f"  • Estimated Max Capacity: ~{int(current_capacity)} concurrent users")
    
    results["capacity_estimation"] = {
        "safety_margin": safety_margin,
        "avg_cpu_usage_pct": round(avg_cpu_usage, 2),
        "avg_memory_usage_pct": round(avg_memory_usage, 2),
        "available_cpu_pct": round(available_cpu_pct, 2),
        "available_memory_pct": round(available_memory_pct, 2),
        "available_cpu_cores": round(available_cpu_cores, 2),
        "available_memory_gb": round(available_memory_gb, 2),
        "estimated_capacity_by_cpu": int(cpu_based_capacity),
        "estimated_capacity_by_memory": int(memory_based_capacity),
        "current_bottleneck": bottleneck,
        "estimated_max_users": int(current_capacity),
    }
    
    # ===========================================
    # 5. SCALE REQUIREMENTS FOR TARGET USERS
    # ===========================================
    print(f"\n{'='*60}")
    print(f"5️⃣ SCALE REQUIREMENTS FOR {target_users} USERS")
    print(f"{'='*60}")
    
    # Calculate required resources
    required_cpu = target_users * RESOURCE_PER_USER["cpu_cores"]
    required_memory = target_users * RESOURCE_PER_USER["memory_gb"]
    required_network = target_users * RESOURCE_PER_USER["network_mbps"]
    
    # Add safety margin
    required_cpu_with_margin = required_cpu / safety_margin
    required_memory_with_margin = required_memory / safety_margin
    
    # Calculate additional resources needed
    additional_cpu = max(0, required_cpu_with_margin - total_vcpu)
    additional_memory = max(0, required_memory_with_margin - total_memory_gb)
    
    print(f"\n📋 Resource Requirements for {target_users} users:")
    print(f"  • CPU Required: {required_cpu_with_margin:.1f} vCPU (with {int(safety_margin*100)}% headroom)")
    print(f"  • Memory Required: {required_memory_with_margin:.1f} GB (with {int(safety_margin*100)}% headroom)")
    print(f"  • Network Required: {required_network:.0f} Mbps")
    
    print(f"\n📈 Additional Resources Needed:")
    print(f"  • Additional CPU: {additional_cpu:.1f} vCPU")
    print(f"  • Additional Memory: {additional_memory:.1f} GB")
    
    # Determine scale strategy
    if additional_cpu <= 0 and additional_memory <= 0:
        scale_strategy = "no_change"
        print(f"\n✅ Current infrastructure can handle {target_users} users!")
    elif additional_cpu <= total_vcpu * 0.5 and additional_memory <= total_memory_gb * 0.5:
        scale_strategy = "vertical"
        print(f"\n📊 Recommendation: Vertical Scaling (upgrade existing nodes)")
    else:
        scale_strategy = "horizontal"
        additional_nodes = max(
            math.ceil(additional_cpu / (total_vcpu / len(nodes))),
            math.ceil(additional_memory / (total_memory_gb / len(nodes)))
        )
        print(f"\n📊 Recommendation: Horizontal Scaling (add {additional_nodes} nodes)")
    
    results["scale_requirements"] = {
        "target_users": target_users,
        "required_cpu_cores": round(required_cpu_with_margin, 2),
        "required_memory_gb": round(required_memory_with_margin, 2),
        "required_network_mbps": round(required_network, 2),
        "additional_cpu_needed": round(additional_cpu, 2),
        "additional_memory_needed": round(additional_memory, 2),
        "scale_strategy": scale_strategy,
    }
    
    # ===========================================
    # 6. GCP COST ANALYSIS
    # ===========================================
    print(f"\n{'='*60}")
    print("6️⃣ GCP COST ANALYSIS")
    print(f"{'='*60}")
    
    # Estimate current infrastructure cost
    # Assuming n2-standard-4 for each node (4 vCPU, 16GB)
    current_instance_type = "n2-standard-4"
    current_price_hour = GCP_PRICING["compute"][current_instance_type]["price_hour"]
    current_monthly_compute = len(nodes) * current_price_hour * 24 * 30
    
    # Storage estimate (100GB SSD per node)
    storage_gb_per_node = 100
    current_monthly_storage = len(nodes) * storage_gb_per_node * GCP_PRICING["storage"]["pd-ssd"]
    
    # Network estimate (500GB egress per month)
    monthly_egress_gb = 500
    current_monthly_network = monthly_egress_gb * GCP_PRICING["network"]["egress_apac"]
    
    current_total_monthly = current_monthly_compute + current_monthly_storage + current_monthly_network
    
    print(f"\n💰 Current Infrastructure Cost (estimated):")
    print(f"  • Compute ({len(nodes)}x {current_instance_type}): ${current_monthly_compute:.2f}/month")
    print(f"  • Storage ({len(nodes)}x {storage_gb_per_node}GB SSD): ${current_monthly_storage:.2f}/month")
    print(f"  • Network ({monthly_egress_gb}GB egress): ${current_monthly_network:.2f}/month")
    print(f"  • Total: ${current_total_monthly:.2f}/month")
    
    # Calculate cost for target users
    if scale_strategy == "no_change":
        target_monthly = current_total_monthly
        target_instance_type = current_instance_type
        target_node_count = len(nodes)
    else:
        # Find suitable instance type
        target_vcpu_per_node = math.ceil(required_cpu_with_margin / len(nodes))
        target_memory_per_node = math.ceil(required_memory_with_margin / len(nodes))
        
        # Select instance type based on requirements
        suitable_types = []
        for instance_type, specs in GCP_PRICING["compute"].items():
            if specs["vcpu"] >= target_vcpu_per_node and specs["memory_gb"] >= target_memory_per_node:
                suitable_types.append((instance_type, specs))
        
        if suitable_types:
            # Sort by price and select cheapest
            suitable_types.sort(key=lambda x: x[1]["price_hour"])
            target_instance_type, target_specs = suitable_types[0]
            target_node_count = len(nodes)
            
            # Check if horizontal scaling is better
            if scale_strategy == "horizontal":
                current_vcpu_per_node = total_vcpu / len(nodes)
                target_node_count = math.ceil(required_cpu_with_margin / current_vcpu_per_node)
                target_instance_type = current_instance_type
                target_specs = GCP_PRICING["compute"][current_instance_type]
        else:
            target_instance_type = "n2-standard-16"
            target_specs = GCP_PRICING["compute"][target_instance_type]
            target_node_count = len(nodes)
        
        target_price_hour = GCP_PRICING["compute"][target_instance_type]["price_hour"]
        target_monthly_compute = target_node_count * target_price_hour * 24 * 30
        
        # Increased storage for more users
        target_storage_gb = storage_gb_per_node * target_node_count * 1.5
        target_monthly_storage = target_storage_gb * GCP_PRICING["storage"]["pd-ssd"]
        
        # Increased network for more users
        target_egress_gb = monthly_egress_gb * (target_users / max(int(current_capacity), 1))
        target_monthly_network = target_egress_gb * GCP_PRICING["network"]["egress_apac"]
        
        target_monthly = target_monthly_compute + target_monthly_storage + target_monthly_network
    
    print(f"\n💰 Projected Cost for {target_users} users:")
    print(f"  • Compute ({target_node_count}x {target_instance_type}): ${target_monthly_compute:.2f}/month")
    print(f"  • Storage: ${target_monthly_storage:.2f}/month")
    print(f"  • Network: ${target_monthly_network:.2f}/month")
    print(f"  • Total: ${target_monthly:.2f}/month")
    
    cost_increase = target_monthly - current_total_monthly
    cost_increase_pct = (cost_increase / current_total_monthly) * 100 if current_total_monthly > 0 else 0
    
    print(f"\n📊 Cost Difference:")
    print(f"  • Increase: ${cost_increase:.2f}/month ({cost_increase_pct:.1f}%)")
    
    # Cost optimization
    cud_1yr_monthly = target_monthly * (1 - GCP_PRICING["cud_1yr_discount"])
    cud_3yr_monthly = target_monthly * (1 - GCP_PRICING["cud_3yr_discount"])
    
    print(f"\n💡 Cost Optimization:")
    print(f"  • With 1-year CUD: ${cud_1yr_monthly:.2f}/month (save {GCP_PRICING['cud_1yr_discount']*100:.0f}%)")
    print(f"  • With 3-year CUD: ${cud_3yr_monthly:.2f}/month (save {GCP_PRICING['cud_3yr_discount']*100:.0f}%)")
    
    results["cost_analysis"] = {
        "current": {
            "instance_type": current_instance_type,
            "node_count": len(nodes),
            "monthly_compute": round(current_monthly_compute, 2),
            "monthly_storage": round(current_monthly_storage, 2),
            "monthly_network": round(current_monthly_network, 2),
            "monthly_total": round(current_total_monthly, 2),
        },
        "target": {
            "instance_type": target_instance_type,
            "node_count": target_node_count,
            "monthly_compute": round(target_monthly_compute, 2),
            "monthly_storage": round(target_monthly_storage, 2),
            "monthly_network": round(target_monthly_network, 2),
            "monthly_total": round(target_monthly, 2),
        },
        "cost_increase": round(cost_increase, 2),
        "cost_increase_pct": round(cost_increase_pct, 2),
        "with_1yr_cud": round(cud_1yr_monthly, 2),
        "with_3yr_cud": round(cud_3yr_monthly, 2),
    }
    
    # ===========================================
    # 7. RECOMMENDATIONS
    # ===========================================
    print(f"\n{'='*60}")
    print("7️⃣ RECOMMENDATIONS")
    print(f"{'='*60}")
    
    recommendations = []
    
    # Capacity recommendation
    if current_capacity < target_users:
        if scale_strategy == "vertical":
            recommendations.append(f"🔼 Upgrade existing {len(nodes)} nodes to {target_instance_type}")
        else:
            recommendations.append(f"➕ Add {target_node_count - len(nodes)} more nodes ({current_instance_type})")
    else:
        recommendations.append(f"✅ Current infrastructure can handle {target_users} users")
    
    # Performance recommendations
    if stt_latency_stats['p95'] > 3:
        recommendations.append("⚠️ STT latency high (>3s P95) - consider STT service scaling")
    if trans_latency_stats['p95'] > 2:
        recommendations.append("⚠️ Translation latency high (>2s P95) - consider caching optimization")
    
    # Cost recommendations
    recommendations.append(f"💰 Consider 1-year CUD to save ${target_monthly - cud_1yr_monthly:.2f}/month")
    recommendations.append(f"💰 Consider 3-year CUD to save ${target_monthly - cud_3yr_monthly:.2f}/month")
    
    # Resource utilization recommendations
    if avg_cpu_usage > 70:
        recommendations.append("📈 High average CPU usage - monitor for spikes")
    if avg_memory_usage > 70:
        recommendations.append("📈 High average memory usage - monitor for OOM")
    
    print()
    for rec in recommendations:
        print(f"  • {rec}")
    
    results["recommendations"] = recommendations
    
    return results


def generate_report(results: dict, output_path: str):
    """Generate markdown report from analysis results."""
    
    report = f"""# Capacity Assessment Report - JBCalling Translation System

**Generated**: {results['analysis_time']}  
**Data Period**: {results.get('data_period', {}).get('start', 'N/A')} to {results.get('data_period', {}).get('end', 'N/A')}  
**Target Users**: {results['target_users']} concurrent

---

## Executive Summary

| Metric | Current | Target ({results['target_users']} users) |
|--------|---------|--------|
| Nodes | {results['current_infrastructure']['node_count']} | {results['cost_analysis']['target']['node_count']} |
| Total vCPU | {results['current_infrastructure']['total_vcpu']} | {results['scale_requirements']['required_cpu_cores']:.0f} |
| Total Memory | {results['current_infrastructure']['total_memory_gb']:.0f} GB | {results['scale_requirements']['required_memory_gb']:.0f} GB |
| Monthly Cost | ${results['cost_analysis']['current']['monthly_total']:.2f} | ${results['cost_analysis']['target']['monthly_total']:.2f} |

**Scale Strategy**: {results['scale_requirements']['scale_strategy'].replace('_', ' ').title()}  
**Cost Increase**: ${results['cost_analysis']['cost_increase']:.2f}/month ({results['cost_analysis']['cost_increase_pct']:.1f}%)

---

## 1. Current Infrastructure

### Nodes Overview
"""
    
    for node, specs in results['current_infrastructure']['per_node'].items():
        report += f"- **{node}**: {specs['vcpu']} vCPU, {specs['memory_gb']} GB RAM\n"
    
    report += f"""
### Resource Utilization (24h Average)

| Node | CPU Usage | Memory Usage |
|------|-----------|--------------|
"""
    
    for node in results['current_infrastructure']['nodes']:
        cpu = results['resource_usage']['cpu'].get(node, {}).get('avg', 0)
        mem = results['resource_usage']['memory'].get(node, {}).get('avg', 0)
        report += f"| {node} | {cpu:.1f}% | {mem:.1f}% |\n"
    
    report += f"""
---

## 2. Service Performance

| Service | P95 Latency | Avg Request Rate | Status |
|---------|-------------|------------------|--------|
| STT | {results['service_performance']['stt']['p95_latency_seconds']['avg']:.2f}s | {results['service_performance']['stt']['request_rate']['avg']:.2f}/s | {'✅' if results['service_performance']['stt']['p95_latency_seconds']['avg'] < 3 else '⚠️'} |
| Translation | {results['service_performance']['translation']['p95_latency_seconds']['avg']:.2f}s | {results['service_performance']['translation']['request_rate']['avg']:.2f}/s | {'✅' if results['service_performance']['translation']['p95_latency_seconds']['avg'] < 2 else '⚠️'} |
| TTS | {results['service_performance']['tts']['response_time_seconds']['avg']:.2f}s | N/A | {'✅' if results['service_performance']['tts']['response_time_seconds']['avg'] < 1 else '⚠️'} |
| Gateway | N/A | {results['service_performance']['gateway']['active_rooms']['avg']:.0f} rooms | ✅ |

---

## 3. Capacity Analysis

### Current Capacity Estimation
- **Estimated Max Users**: ~{results['capacity_estimation']['estimated_max_users']} concurrent
- **Current Bottleneck**: {results['capacity_estimation']['current_bottleneck']}
- **CPU Headroom**: {results['capacity_estimation']['available_cpu_pct']:.1f}%
- **Memory Headroom**: {results['capacity_estimation']['available_memory_pct']:.1f}%

### Requirements for {results['target_users']} Users
- **CPU Required**: {results['scale_requirements']['required_cpu_cores']:.0f} vCPU
- **Memory Required**: {results['scale_requirements']['required_memory_gb']:.0f} GB
- **Network Required**: {results['scale_requirements']['required_network_mbps']:.0f} Mbps
- **Additional CPU Needed**: {results['scale_requirements']['additional_cpu_needed']:.1f} vCPU
- **Additional Memory Needed**: {results['scale_requirements']['additional_memory_needed']:.1f} GB

---

## 4. GCP Cost Analysis

### Current Monthly Cost
| Component | Cost |
|-----------|------|
| Compute ({results['cost_analysis']['current']['node_count']}x {results['cost_analysis']['current']['instance_type']}) | ${results['cost_analysis']['current']['monthly_compute']:.2f} |
| Storage | ${results['cost_analysis']['current']['monthly_storage']:.2f} |
| Network Egress | ${results['cost_analysis']['current']['monthly_network']:.2f} |
| **Total** | **${results['cost_analysis']['current']['monthly_total']:.2f}** |

### Projected Monthly Cost ({results['target_users']} users)
| Component | Cost |
|-----------|------|
| Compute ({results['cost_analysis']['target']['node_count']}x {results['cost_analysis']['target']['instance_type']}) | ${results['cost_analysis']['target']['monthly_compute']:.2f} |
| Storage | ${results['cost_analysis']['target']['monthly_storage']:.2f} |
| Network Egress | ${results['cost_analysis']['target']['monthly_network']:.2f} |
| **Total** | **${results['cost_analysis']['target']['monthly_total']:.2f}** |

### Cost Optimization Options
| Option | Monthly Cost | Savings |
|--------|--------------|---------|
| On-Demand | ${results['cost_analysis']['target']['monthly_total']:.2f} | - |
| 1-Year CUD | ${results['cost_analysis']['with_1yr_cud']:.2f} | {GCP_PRICING['cud_1yr_discount']*100:.0f}% |
| 3-Year CUD | ${results['cost_analysis']['with_3yr_cud']:.2f} | {GCP_PRICING['cud_3yr_discount']*100:.0f}% |

---

## 5. Recommendations

"""
    
    for i, rec in enumerate(results['recommendations'], 1):
        report += f"{i}. {rec}\n"
    
    report += f"""
---

## 6. Scale Plan

### Immediate Actions (if scaling needed)
1. Backup current configuration
2. Test in staging environment first
3. Schedule maintenance window
4. Execute scale operation
5. Verify service health
6. Monitor for 24h post-scale

### Monitoring Checklist
- [ ] CPU usage < 80% sustained
- [ ] Memory usage < 85% sustained
- [ ] STT P95 latency < 3s
- [ ] Translation P95 latency < 2s
- [ ] Error rate < 1%
- [ ] All services healthy

---

*Report generated by JBCalling Capacity Analysis Tool*
"""
    
    with open(output_path, 'w') as f:
        f.write(report)
    
    print(f"\n📄 Report saved to: {output_path}")


def main():
    parser = argparse.ArgumentParser(description='Analyze JBCalling capacity and GCP costs')
    parser.add_argument('--data-dir', type=str, default='./capacity-data',
                        help='Directory containing collected Prometheus data')
    parser.add_argument('--target-users', type=int, default=500,
                        help='Target number of concurrent users')
    parser.add_argument('--output', type=str, default=None,
                        help='Output report path (default: data-dir/CAPACITY-REPORT.md)')
    
    args = parser.parse_args()
    
    if not os.path.exists(args.data_dir):
        print(f"Error: Data directory not found: {args.data_dir}")
        print("Run collect-capacity-data.sh first to collect metrics.")
        return 1
    
    # Run analysis
    results = analyze_capacity(args.data_dir, args.target_users)
    
    # Save raw results
    results_path = os.path.join(args.data_dir, "analysis-results.json")
    with open(results_path, 'w') as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\n📊 Raw results saved to: {results_path}")
    
    # Generate report
    report_path = args.output or os.path.join(args.data_dir, "CAPACITY-REPORT.md")
    generate_report(results, report_path)
    
    return 0


if __name__ == "__main__":
    exit(main())


