//! Typed error envelope for viola-deno-runtime internal paths.

/// Typed error enum replacing the previous `Result<_, String>` shape.
/// Each variant identifies the specific failure point; callers map to
/// `ExtensionAbiStatus` at the FFI boundary.
#[derive(Copy, Clone, Debug)]
pub(crate) enum DenoRuntimeError {
    BridgeWriteFailed,
    SpawnDenoFailed,
    NoStdin,
    NoStdout,
    ConfigBytesEmpty,
    ConfigNotUtf8,
    ConfigCanonicalizeFailed,
    ConfigPathTooLong,
    WriteWorkerFailed,
    ReadWorkerFailed,
    WorkerEofUnexpected,
    WorkerStdinClosed,
    EncodeBufferFull,
    DecodeMalformed,
    WorkerReportedError,
    ArenaBytesFull,
    ArenaDiagsFull,
    LineTooLong,
    BadSeverity,
    TempNameOverflow,
    TempDirNotUtf8,
}

impl DenoRuntimeError {
    pub(crate) fn label(&self) -> &'static [u8] {
        match self {
            Self::BridgeWriteFailed => b"bridge.ts write failed",
            Self::SpawnDenoFailed => b"spawn deno failed",
            Self::NoStdin => b"no stdin pipe",
            Self::NoStdout => b"no stdout pipe",
            Self::ConfigBytesEmpty => b"lint_config bytes empty (no [ts].config provided)",
            Self::ConfigNotUtf8 => b"config path not UTF-8",
            Self::ConfigCanonicalizeFailed => b"canonicalize config path failed",
            Self::ConfigPathTooLong => b"config path too long for stack buffer",
            Self::WriteWorkerFailed => b"write to worker failed",
            Self::ReadWorkerFailed => b"read from worker failed",
            Self::WorkerEofUnexpected => b"worker closed stdout unexpectedly",
            Self::WorkerStdinClosed => b"worker stdin already closed",
            Self::EncodeBufferFull => b"encode buffer full",
            Self::DecodeMalformed => b"decode worker message malformed",
            Self::WorkerReportedError => b"worker reported error",
            Self::ArenaBytesFull => b"diagnostic arena byte buffer full",
            Self::ArenaDiagsFull => b"diagnostic arena diag slots full",
            Self::LineTooLong => b"worker stdout line exceeds line buffer",
            Self::BadSeverity => b"unknown severity from worker",
            Self::TempNameOverflow => b"temp file name overflow",
            Self::TempDirNotUtf8 => b"temp dir not UTF-8",
        }
    }

    pub(crate) fn report(&self) {
        std::eprintln!(                                              // lint:allow(no-std) -- eprintln only on the error path. tracked: #197
            "viola-deno-runtime: {}",
            core::str::from_utf8(self.label()).unwrap_or("(non-utf8 label)")
        );
    }
}
