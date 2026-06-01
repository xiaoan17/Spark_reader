fn main() {
    if let Some(exit_code) = focused_reading_lib::run_cli_if_requested() {
        std::process::exit(exit_code);
    }
    focused_reading_lib::run()
}
