import UIKit

private extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xff) / 255,
            green: CGFloat((hex >> 8) & 0xff) / 255,
            blue: CGFloat(hex & 0xff) / 255,
            alpha: CGFloat((hex >> 24) & 0xff) / 255
        )
    }
}

enum ColorToken {
    static let buttonPrimaryBg: UIColor = UIColor { trait in
        trait.userInterfaceStyle == .dark ? UIColor(hex: 0xff60a5fa) : UIColor(hex: 0xff2563eb)
    }
    static let buttonPrimaryFg: UIColor = UIColor { trait in
        trait.userInterfaceStyle == .dark ? UIColor(hex: 0xff0f172a) : UIColor(hex: 0xffffffff)
    }
    static let buttonSecondaryBg: UIColor = UIColor { trait in
        trait.userInterfaceStyle == .dark ? UIColor(hex: 0xff334155) : UIColor(hex: 0xffe2e8f0)
    }
    static let buttonSecondaryFg: UIColor = UIColor { trait in
        trait.userInterfaceStyle == .dark ? UIColor(hex: 0xfff8fafc) : UIColor(hex: 0xff1e293b)
    }
}

enum SpaceToken {
    static let md: CGFloat = 16
    static let sm: CGFloat = 8
}

enum TypoToken {
    static let labelMdFontFamily: String = "Inter"
    static let labelMdFontSize: CGFloat = 14
    static let labelMdFontWeight: CGFloat = 600
    static let labelMdLetterSpacing: CGFloat = 0
    static let labelMdLineHeight: CGFloat = 20
}
