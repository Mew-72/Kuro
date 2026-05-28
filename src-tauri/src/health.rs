use serde::Serialize;
use sysinfo::System;

#[derive(Debug, Clone, Serialize)]
pub struct SystemHealth {
    pub cpu_percent: f32,
    pub ram_percent: f32,
    pub battery_percent: u8,
    pub is_charging: bool,
    pub open_window_count: u32,
}

pub fn refresh_health(sys: &mut System) -> SystemHealth {
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    let cpu = sys.global_cpu_info().cpu_usage();
    let ram = if sys.total_memory() > 0 {
        (sys.used_memory() as f32 / sys.total_memory() as f32) * 100.0
    } else { 0.0 };
    let (batt, charging) = get_battery_info();
    SystemHealth { cpu_percent: cpu, ram_percent: ram, battery_percent: batt, is_charging: charging, open_window_count: 0 }
}

fn get_battery_info() -> (u8, bool) {
    let manager = match battery::Manager::new() { Ok(m) => m, Err(_) => return (100, true) };
    let mut batteries = match manager.batteries() { Ok(b) => b, Err(_) => return (100, true) };
    if let Some(Ok(bat)) = batteries.next() {
        use battery::units::ratio::percent;
        let pct = bat.state_of_charge().get::<percent>() as u8;
        let chg = bat.state() == battery::State::Charging || bat.state() == battery::State::Full;
        (pct, chg)
    } else { (100, true) }
}

#[derive(Debug, Clone, Serialize)]
pub struct HealthAlert { pub alert_type: String, pub value: f32 }

pub fn check_thresholds(health: &SystemHealth) -> Vec<HealthAlert> {
    let mut alerts = Vec::new();
    if health.cpu_percent > 85.0 {
        alerts.push(HealthAlert { alert_type: "cpu_high".into(), value: health.cpu_percent });
    }
    if health.ram_percent > 85.0 {
        alerts.push(HealthAlert { alert_type: "ram_high".into(), value: health.ram_percent });
    }
    if !health.is_charging && health.battery_percent < 5 {
        alerts.push(HealthAlert { alert_type: "battery_critical".into(), value: health.battery_percent as f32 });
    } else if !health.is_charging && health.battery_percent < 15 {
        alerts.push(HealthAlert { alert_type: "battery_low".into(), value: health.battery_percent as f32 });
    }
    alerts
}
