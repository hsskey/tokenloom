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
    static let brand500: UIColor = UIColor(hex: 0xff1a73e8)
    static let buttonPrimaryBg: UIColor = UIColor { trait in
        trait.userInterfaceStyle == .dark ? UIColor(hex: 0xff8ab4f8) : ColorToken.brand500
    }
    static let buttonPrimaryFg: UIColor = UIColor { trait in
        trait.userInterfaceStyle == .dark ? ColorToken.neutral900 : ColorToken.neutral0
    }
    static let buttonSecondaryBg: UIColor = UIColor { trait in
        trait.userInterfaceStyle == .dark ? UIColor(hex: 0xff303134) : ColorToken.neutral100
    }
    static let buttonSecondaryFg: UIColor = UIColor { trait in
        trait.userInterfaceStyle == .dark ? ColorToken.neutral0 : ColorToken.neutral900
    }
    static let neutral0: UIColor = UIColor(hex: 0xffffffff)
    static let neutral100: UIColor = UIColor(hex: 0xfff1f3f4)
    static let neutral900: UIColor = UIColor(hex: 0xff1f1f1f)
}

enum RadiusToken {
    static let md: CGFloat = 8
}

enum SpaceToken {
    static let md: CGFloat = 16
    static let sm: CGFloat = 8
}

enum TypoToken {
    static let labelMdFontFamily: String = "Inter"
    static let labelMdFontSize: CGFloat = 14
    static let labelMdFontWeight: CGFloat = 600
    static let labelMdLineHeight: CGFloat = 20
}
